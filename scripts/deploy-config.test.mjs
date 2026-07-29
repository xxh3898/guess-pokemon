import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  validateWorkflow,
  deployWorkflow,
  deployScript,
  restrictedWrapper,
  productionBackupScript,
  operations,
] = await Promise.all([
  read("../.github/workflows/validate.yml"),
  read("../.github/workflows/deploy.yml"),
  read("./deploy-guess-pokemon.sh"),
  read("./deploy-guess-pokemon-ci.sh"),
  read("./backup-production-db.sh"),
  read("../docs/OPERATIONS.md"),
]);

test("should_validateDevAndPullRequestsInParallelOnNativeArmBeforeRelease", () => {
  assert.match(
    validateWorkflow,
    /push:\n    branches:\n      - dev/,
  );
  assert.match(
    validateWorkflow,
    /pull_request:\n    branches:\n      - main/,
  );
  assert.match(validateWorkflow, /run --rm\n          frontend-test/);
  assert.match(validateWorkflow, /run --rm\n          backend-test/);
  assert.match(
    validateWorkflow,
    /run: ENV_FILE=\.env\.example \.\/scripts\/verify-compose\.sh/,
  );
  assert.match(validateWorkflow, /frontend:\n    name: Frontend checks/);
  assert.match(validateWorkflow, /backend:\n    name: Backend checks/);
  assert.match(
    validateWorkflow,
    /infrastructure:\n    name: Infrastructure checks/,
  );
  assert.match(
    validateWorkflow,
    /backend-image:\n    name: Backend ARM64 image\n    runs-on: ubuntu-24\.04-arm/,
  );
  assert.match(
    validateWorkflow,
    /frontend-image:\n    name: Frontend ARM64 image\n    runs-on: ubuntu-24\.04-arm/,
  );
  for (const jobId of [
    "infrastructure",
    "frontend",
    "backend",
    "backend-image",
    "frontend-image",
  ]) {
    assert.doesNotMatch(
      workflowJob(validateWorkflow, jobId),
      /^    needs:/m,
    );
  }
  assert.match(validateWorkflow, /platforms: linux\/arm64/g);
  assert.doesNotMatch(validateWorkflow, /docker\/setup-qemu-action/);
});

test("should_cacheBackendGradleDependenciesWithoutSkippingTests", () => {
  const backendJob = workflowJob(validateWorkflow, "backend");

  assert.doesNotMatch(backendJob, /^    env:\n/m);
  assert.match(
    backendJob,
    /BACKEND_GRADLE_USER_HOME_VOLUME: \$\{\{ runner\.temp \}\}\/gradle-user-home/,
  );
  assert.match(
    backendJob,
    /uses: actions\/cache@[0-9a-f]{40} # v6\.1\.0/,
  );
  assert.match(
    backendJob,
    /\$\{\{ runner\.temp \}\}\/gradle-user-home\/caches/,
  );
  assert.match(
    backendJob,
    /\$\{\{ runner\.temp \}\}\/gradle-user-home\/wrapper/,
  );
  assert.match(backendJob, /backend\/\*\*\/\*\.gradle/);
  assert.match(
    backendJob,
    /backend\/gradle\/wrapper\/gradle-wrapper\.properties/,
  );
  assert.doesNotMatch(
    backendJob,
    /--build-cache|--configuration-cache|org\.gradle\.caching/,
  );
});

test("should_publishBothShaImagesOnlyFromMain", () => {
  assert.match(
    deployWorkflow,
    /push:\n    branches:\n      - main/,
  );
  assert.match(
    deployWorkflow,
    /API_IMAGE_NAME: ghcr\.io\/xxh3898\/guess-pokemon-api/,
  );
  assert.match(
    deployWorkflow,
    /WEB_IMAGE_NAME: ghcr\.io\/xxh3898\/guess-pokemon-web/,
  );
  assert.match(
    deployWorkflow,
    /\$\{\{ env\.API_IMAGE_NAME \}\}:\$\{\{ github\.sha \}\}/,
  );
  assert.match(
    deployWorkflow,
    /\$\{\{ env\.WEB_IMAGE_NAME \}\}:\$\{\{ github\.sha \}\}/,
  );
  assert.match(
    deployWorkflow,
    /publish:\n    name: Publish ARM64 images[\s\S]*runs-on: ubuntu-24\.04-arm/,
  );
  assert.doesNotMatch(deployWorkflow, /\n  validate:\n/);
  assert.doesNotMatch(
    workflowJob(deployWorkflow, "publish"),
    /^    needs:/m,
  );
  assert.doesNotMatch(
    deployWorkflow,
    /uses: \.\/\.github\/workflows\/validate\.yml/,
  );
  assert.doesNotMatch(deployWorkflow, /docker\/setup-qemu-action/);
  assert.match(
    deployWorkflow,
    /needs:\n      - publish[\s\S]*packages: read[\s\S]*id-token: write/,
  );
});

test("should_useTailscaleAndRestrictedSshForDeployment", () => {
  assert.match(
    deployWorkflow,
    /uses: tailscale\/github-action@[0-9a-f]{40}/,
  );
  assert.match(deployWorkflow, /tags: tag:ci/);
  assert.match(deployWorkflow, /ping: home-mini/);
  assert.match(
    deployWorkflow,
    /"deploy-guess-pokemon \$\{GITHUB_SHA\} \$\{GITHUB_ACTOR\}"/,
  );
  assert.match(
    restrictedWrapper,
    /\^deploy-guess-pokemon\[\[:space:\]\]\(\[0-9a-fA-F\]\{40\}\)\[\[:space:\]\]\(\[A-Za-z0-9_-\]\+\)\$/,
  );
  assert.doesNotMatch(restrictedWrapper, /eval|bash -c|sh -c/);
});

test("should_backupAndRejectActiveGamesBeforeImageReplacement", () => {
  const activeGameCheck = deployScript.indexOf(
    "SELECT count(*) FROM game WHERE status",
  );
  const backup = deployScript.indexOf(
    '"${BACKUP_SCRIPT}"',
    activeGameCheck,
  );
  const imageWrite = deployScript.indexOf(
    'write_image_env "${new_api_image}" "${new_web_image}"',
  );

  assert.ok(activeGameCheck >= 0);
  assert.ok(backup > activeGameCheck);
  assert.ok(imageWrite > backup);
  assert.match(
    deployScript,
    /deployment stopped because \$\{in_progress_count\} game\(s\) are in progress/,
  );
});

test(
  "should_keepTemporaryRegistryConfigOutOfComposeCommands_when_deployingPulledImages",
  () => {
    const composeFunction = deployScript.match(
      /compose\(\) \{[\s\S]*?\n\}/,
    )?.[0];
    const composeConfig = deployScript.match(
      /API_IMAGE="\$\{new_api_image\}"[\s\S]*?config \\\n    --quiet/,
    )?.[0];
    const composeUpCommands = deployScript.match(
      /compose up \\\n[\s\S]*?--wait-timeout "\$\{HEALTH_TIMEOUT_SECONDS\}"/g,
    );

    assert.ok(composeFunction);
    assert.ok(composeConfig);
    assert.equal(composeUpCommands?.length, 2);
    assert.doesNotMatch(composeFunction, /--config/);
    assert.doesNotMatch(composeConfig, /--config/);
    for (const command of composeUpCommands) {
      assert.match(command, /--pull never/);
    }
  },
);

test("should_rollbackBothImagesWithoutDeletingDatabase", () => {
  assert.match(
    deployScript,
    /previous_api_image="\$\{API_IMAGE_REPOSITORY\}:\$\{previous_sha\}"/,
  );
  assert.match(
    deployScript,
    /previous_web_image="\$\{WEB_IMAGE_REPOSITORY\}:\$\{previous_sha\}"/,
  );
  assert.match(
    deployScript,
    /Database migration is not rolled back automatically/,
  );
  assert.doesNotMatch(
    deployScript,
    /down[^\n]*(?:--volumes|-v)|volume rm|system prune/,
  );
});

test("should_validateArchiveBeforePruningExpiredProjectBackups", () => {
  const restoreList = productionBackupScript.indexOf("pg_restore --list");
  const finalLink = productionBackupScript.indexOf(
    '/bin/ln "${temporary_file}" "${final_file}"',
  );
  const retentionLoop = productionBackupScript.indexOf(
    'for candidate in "${BACKUP_DIR}"/guess-pokemon-production-*.dump',
  );

  assert.ok(restoreList >= 0);
  assert.ok(finalLink > restoreList);
  assert.ok(retentionLoop > finalLink);
  assert.match(
    productionBackupScript,
    /RETENTION_SECONDS=\$\(\(3 \* 24 \* 60 \* 60\)\)/,
  );
  assert.match(
    productionBackupScript,
    /\^guess-pokemon-production-\[0-9\]\{8\}T\[0-9\]\{6\}Z\\\.dump\$/,
  );
  assert.doesNotMatch(
    productionBackupScript,
    /rm -rf|find[^\n]*-delete|down[^\n]*(?:--volumes|-v)/,
  );
});

test("should_documentCiBackupAndMigrationRollbackBoundary", () => {
  assert.match(operations, /`dev` push와 `main` 대상 PR/);
  assert.match(operations, /`main` push에서만 두 ARM64 image/);
  assert.match(operations, /진행 중 game이 1건 이상이면 배포를 중단한다/);
  assert.match(operations, /3일을 초과한 Guess Pokémon archive만 정리한다/);
  assert.match(operations, /DB migration은 자동으로 rollback하지 않는다/);
});

function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function workflowJob(workflow, jobId) {
  const header = `\n  ${jobId}:\n`;
  const start = workflow.indexOf(header);

  assert.ok(start >= 0, `Missing workflow job: ${jobId}`);

  const bodyStart = start + header.length;
  const remaining = workflow.slice(bodyStart);
  const nextJobOffset = remaining.search(/\n  [A-Za-z0-9_-]+:\n/);

  return nextJobOffset >= 0
    ? workflow.slice(start, bodyStart + nextJobOffset)
    : workflow.slice(start);
}
