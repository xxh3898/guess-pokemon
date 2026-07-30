import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  validateWorkflow,
  deployWorkflow,
  deployScript,
  restrictedWrapper,
  productionBackupScript,
  operations,
  pathClassifier,
  runtimeConfigDockerfile,
  runtimeConfigDetector,
] = await Promise.all([
  read("../.github/workflows/validate.yml"),
  read("../.github/workflows/deploy.yml"),
  read("./deploy-guess-pokemon.sh"),
  read("./deploy-guess-pokemon-ci.sh"),
  read("./backup-production-db.sh"),
  read("../docs/OPERATIONS.md"),
  read("./classify-ci-paths.sh"),
  read("../runtime-config.Dockerfile"),
  read("./detect-runtime-config-change.sh"),
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
    workflowJob(validateWorkflow, "backend-image"),
    /name: Backend ARM64 image[\s\S]*runs-on: ubuntu-24\.04-arm/,
  );
  assert.match(
    workflowJob(validateWorkflow, "frontend-image"),
    /name: Frontend ARM64 image[\s\S]*runs-on: ubuntu-24\.04-arm/,
  );
  for (const jobId of [
    "infrastructure",
    "frontend",
    "backend",
    "backend-image",
    "frontend-image",
  ]) {
    assert.match(
      workflowJob(validateWorkflow, jobId),
      /^    needs:\n      - changes/m,
    );
    assert.match(
      workflowJob(validateWorkflow, jobId),
      /^    if: \$\{\{ always\(\) \}\}$/m,
    );
    assert.match(
      workflowJob(validateWorkflow, jobId),
      /- name: Fail when change detection fails\n        if: needs\.changes\.result != 'success'\n        run: exit 1/,
    );
    assert.match(
      workflowJob(validateWorkflow, jobId),
      /- name: Skip unrelated/,
    );
    assert.match(
      workflowJob(validateWorkflow, jobId),
      /if: needs\.changes\.result == 'success' && needs\.changes\.outputs\./,
    );
  }
  assert.match(validateWorkflow, /changes:\n    name: Detect changes/);
  assert.match(
    validateWorkflow,
    /mapfile -d '' -t changed_paths < <\([\s\S]*git diff[\s\S]*--no-renames[\s\S]*--name-only[\s\S]*-z/,
  );
  assert.match(
    validateWorkflow,
    /\.\/scripts\/classify-ci-paths\.sh "\$\{changed_paths\[@\]\}"/,
  );
  assert.match(
    validateWorkflow,
    /\.\/scripts\/classify-ci-paths\.sh \\\n\s+"\.github\/workflows\/validate\.yml"/,
  );
  assert.match(validateWorkflow, /platforms: linux\/arm64/g);
  assert.doesNotMatch(validateWorkflow, /docker\/setup-qemu-action/);
});

test("should_runOnlyFrontendChecks_when_frontendSourceChanges", () => {
  assert.deepEqual(classifyPaths(["frontend/src/App.tsx"]), {
    backend: "false",
    frontend: "true",
    infrastructure: "false",
    backend_image: "false",
    frontend_image: "true",
  });
});

test("should_runInfrastructureAndFrontendChecks_when_frontendDockerfileChanges", () => {
  assert.deepEqual(classifyPaths(["frontend/Dockerfile"]), {
    backend: "false",
    frontend: "true",
    infrastructure: "true",
    backend_image: "false",
    frontend_image: "true",
  });
});

test("should_runOnlyBackendChecks_when_backendSourceChanges", () => {
  assert.deepEqual(classifyPaths(["backend/src/main/java/App.java"]), {
    backend: "true",
    frontend: "false",
    infrastructure: "false",
    backend_image: "true",
    frontend_image: "false",
  });
});

test("should_runInfraAndFrontendImage_when_nginxChanges", () => {
  assert.deepEqual(classifyPaths(["infra/nginx/default.conf"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "true",
    backend_image: "false",
    frontend_image: "true",
  });
});

test("should_runOnlyInfrastructureChecks_when_operationsDocsChange", () => {
  assert.deepEqual(classifyPaths(["docs/OPERATIONS.md"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "true",
    backend_image: "false",
    frontend_image: "false",
  });
});

test("should_runOnlyInfrastructureChecks_when_runtimeConfigImageChanges", () => {
  assert.deepEqual(classifyPaths(["runtime-config.Dockerfile"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "true",
    backend_image: "false",
    frontend_image: "false",
  });
});

test("should_runBothScopes_when_fileMovesFromFrontendToBackend", () => {
  assert.deepEqual(
    classifyPaths(["frontend/src/old.ts", "backend/src/main/java/New.java"]),
    {
      backend: "true",
      frontend: "true",
      infrastructure: "false",
      backend_image: "true",
      frontend_image: "true",
    },
  );
});

test("should_preserveNonAsciiPath_when_frontendFileChanges", () => {
  assert.deepEqual(classifyPaths(["frontend/src/포켓몬.ts"]), {
    backend: "false",
    frontend: "true",
    infrastructure: "false",
    backend_image: "false",
    frontend_image: "true",
  });
});

test("should_skipExpensiveChecks_when_unrelatedMetadataChanges", () => {
  assert.deepEqual(classifyPaths(["AGENTS.md"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "false",
    backend_image: "false",
    frontend_image: "false",
  });
});

test("should_runEveryCheck_when_classifierOrWorkflowChanges", () => {
  for (const changedPath of [
    "scripts/classify-ci-paths.sh",
    ".github/workflows/validate.yml",
  ]) {
    assert.deepEqual(classifyPaths([changedPath]), {
      backend: "true",
      frontend: "true",
      infrastructure: "true",
      backend_image: "true",
      frontend_image: "true",
    });
  }
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
    /deploy_command="deploy-guess-pokemon-v2 \$\{GITHUB_SHA\} keep \$\{GITHUB_ACTOR\}"/,
  );
  assert.match(
    restrictedWrapper,
    /deploy-guess-pokemon-v2[\s\S]*keep[\s\S]*deploy-guess-pokemon-v2[\s\S]*update/,
  );
  assert.doesNotMatch(restrictedWrapper, /eval|bash -c|sh -c/);
  assert.match(
    workflowJob(deployWorkflow, "deploy"),
    /^    timeout-minutes: 30$/m,
  );
});

test("should_waitForActiveGamesBeforeBackupAndImageReplacement", () => {
  const activeGameCheck = deployScript.indexOf(
    "SELECT count(*) FROM game WHERE status",
  );
  const activeGameWait = deployScript.lastIndexOf(
    "\nwait_for_no_active_games\n",
  );
  const backup = deployScript.indexOf(
    '"${BACKUP_SCRIPT}"',
    activeGameWait,
  );
  const imageWrite = deployScript.indexOf(
    'write_image_env "${new_api_image}" "${new_web_image}"',
  );

  assert.ok(activeGameCheck >= 0);
  assert.ok(activeGameWait > activeGameCheck);
  assert.ok(backup > activeGameWait);
  assert.ok(imageWrite > backup);
  assert.match(
    deployScript,
    /readonly ACTIVE_GAME_POLL_INTERVAL_SECONDS=60/,
  );
  assert.match(
    deployScript,
    /readonly ACTIVE_GAME_WAIT_TIMEOUT_SECONDS=900/,
  );
  assert.match(
    deployScript,
    /\/bin\/sleep "\$\{sleep_seconds\}"/,
  );
  assert.match(
    deployScript,
    /deployment timed out after \$\{ACTIVE_GAME_WAIT_TIMEOUT_SECONDS\}s because \$\{active_game_count\} game\(s\) are still in progress/,
  );
});

test(
  "should_keepTemporaryRegistryConfigOutOfComposeCommands_when_deployingPulledImages",
  () => {
    const composeFunction = deployScript.match(
      /compose\(\) \{[\s\S]*?\n\}/,
    )?.[0];
    const composeConfig = deployScript.match(
      /validate_compose_contract\(\) \{[\s\S]*?\n\}/,
    )?.[0];
    const composeUpCommands = deployScript.match(
      /compose up \\\n[\s\S]*?--wait-timeout "\$\{HEALTH_TIMEOUT_SECONDS\}"/g,
    );

    assert.ok(composeFunction);
    assert.ok(composeConfig);
    assert.equal(composeUpCommands?.length, 3);
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
  assert.match(
    deployScript,
    /active_compose_file="\$\{current_compose_file\}"/,
  );
  assert.match(
    deployScript,
    /RUNTIME_CONFIG_PENDING/,
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
  assert.match(
    operations,
    /진행 중 game이 1건 이상이면 60초마다 다시 확인하며 최대 15분간/,
  );
  assert.match(
    operations,
    /15분 시점에도 남아 있으면 기존 service를 바꾸지 않은 채 실패한다/,
  );
  assert.match(operations, /3일을 초과한 Guess Pokémon archive만 정리한다/);
  assert.match(operations, /DB migration은 자동으로 rollback하지 않는다/);
  assert.match(
    operations,
    /마지막 성공 Production deployment[\s\S]*변경된 배포만[\s\S]*runtime-config/,
  );
  assert.match(operations, /이전 API·Web SHA와 runtime config를 함께 복구한다/);
});

test("should_publishRuntimeConfigOnly_when_allowlistedFilesChange", () => {
  assert.match(
    deployWorkflow,
    /RUNTIME_CONFIG_IMAGE_NAME: ghcr\.io\/xxh3898\/guess-pokemon-runtime-config/,
  );
  assert.match(
    deployWorkflow,
    /if: steps\.runtime-config-mode\.outputs\.mode == 'update'/,
  );
  assert.match(
    deployWorkflow,
    /RUNTIME_CONFIG_MODE: \$\{\{ needs\.publish\.outputs\.runtime_config_mode \}\}/,
  );
  assert.match(
    deployWorkflow,
    /deployments\?environment=Production[\s\S]*steps\.deployed-base\.outputs\.sha/,
  );
  assert.match(
    deployWorkflow,
    /deploy:[\s\S]*environment: Production[\s\S]*RUNTIME_CONFIG_MODE/,
  );
  assert.match(
    deployScript,
    /write_pending_state[\s\S]*"\$\{previous_sha:-\$\{ZERO_SHA\}\}"/,
  );
  assert.match(
    runtimeConfigDetector,
    /compose\.production\.yaml[\s\S]*infra\/nginx\/cloudflare-edge-real-ip\.conf[\s\S]*runtime-config\.Dockerfile/,
  );
  assert.match(
    runtimeConfigDockerfile,
    /FROM scratch[\s\S]*COPY compose\.production\.yaml \/runtime\/compose\.yaml[\s\S]*COPY infra\/nginx\/cloudflare-edge-real-ip\.conf/,
  );

  assert.match(runtimeConfigDetector, /git diff --quiet/);
  assert.match(runtimeConfigDetector, /printf 'keep\\n'/);
  assert.match(runtimeConfigDetector, /printf 'update\\n'/);
});

function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function classifyPaths(paths) {
  const result = spawnSync(
    new URL("./classify-ci-paths.sh", import.meta.url).pathname,
    paths,
    {
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.match(pathClassifier, /^#!\/bin\/sh\n\nset -eu$/m);

  return Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
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
