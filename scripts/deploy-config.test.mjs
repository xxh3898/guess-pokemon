import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  validateWorkflow,
  deployWorkflow,
  productionCompose,
  deployScript,
  restrictedWrapper,
  productionBackupBootstrap,
  productionBackupScript,
  operations,
  pathClassifier,
  runtimeConfigDockerfile,
  runtimeConfigDetector,
] = await Promise.all([
  read("../.github/workflows/validate.yml"),
  read("../.github/workflows/deploy.yml"),
  read("../compose.production.yaml"),
  read("./deploy-guess-pokemon.sh"),
  read("./deploy-guess-pokemon-ci.sh"),
  read("./backup-production-db-bootstrap.sh"),
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
    workflowJob(validateWorkflow, "api-image"),
    /name: API ARM64 image[\s\S]*runs-on: ubuntu-24\.04-arm/,
  );
  assert.match(
    workflowJob(validateWorkflow, "web-image"),
    /name: Web ARM64 image[\s\S]*runs-on: ubuntu-24\.04-arm/,
  );
  for (const jobId of [
    "infrastructure",
    "frontend",
    "backend",
    "api-image",
    "web-image",
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
    /\.\/scripts\/classify-ci-paths\.sh "\$\{changed_paths\[@\]\}"/,
  );
  assert.match(
    validateWorkflow,
    /\.\/scripts\/classify-ci-paths\.sh \\\n\s+"\.github\/workflows\/validate\.yml"/,
  );
  assert.match(validateWorkflow, /platforms: linux\/arm64/g);
  assert.doesNotMatch(validateWorkflow, /docker\/setup-qemu-action/);
  assert.doesNotMatch(
    validateWorkflow,
    /backend_image|frontend_image|backend-image|frontend-image/,
  );
});

test("should_failClosed_when_changedPathDiffFails", () => {
  const tempFileOffset = validateWorkflow.indexOf(
    'changed_paths_file="$(mktemp "${RUNNER_TEMP}/ci-changed-paths.XXXXXX")"',
  );
  const diffGuardOffset = validateWorkflow.indexOf(
    "if ! git diff",
    tempFileOffset,
  );
  const mapfileOffset = validateWorkflow.indexOf(
    "mapfile -d '' -t changed_paths",
    diffGuardOffset,
  );
  const classifierOffset = validateWorkflow.indexOf(
    './scripts/classify-ci-paths.sh "${changed_paths[@]}"',
    mapfileOffset,
  );

  assert.doesNotMatch(
    validateWorkflow,
    /mapfile -d '' -t changed_paths < <\([\s\S]*git diff/,
  );
  assert.ok(tempFileOffset >= 0, "Missing exact changed-path temp file");
  assert.ok(diffGuardOffset > tempFileOffset, "Diff must follow temp file setup");
  assert.ok(mapfileOffset > diffGuardOffset, "Mapfile must follow checked diff");
  assert.ok(
    classifierOffset > mapfileOffset,
    "Classifier must run only after the checked diff is loaded",
  );
  assert.match(
    validateWorkflow,
    /trap 'rm -f -- "\$\{changed_paths_file\}"' EXIT/,
  );
  assert.match(
    validateWorkflow.slice(diffGuardOffset, mapfileOffset),
    /if ! git diff \\\n+\s+--no-renames \\\n+\s+--name-only \\\n+\s+-z \\\n+\s+"\$\{base_sha\}" \\\n+\s+"\$\{GITHUB_SHA\}" \\\n+\s+>"\$\{changed_paths_file\}"; then[\s\S]*printf '%s\\n' 'Failed to detect changed paths\.' >&2[\s\S]*exit 1[\s\S]*fi/,
  );
  assert.match(
    validateWorkflow.slice(mapfileOffset, classifierOffset),
    /mapfile -d '' -t changed_paths \\\n+\s+<"\$\{changed_paths_file\}"/,
  );
});

test("should_forceFullValidationForMainRelease", () => {
  const fullReleaseGuard =
    'if [[ "${REF_NAME}" == "refs/heads/main" ]]; then';
  const guardOffset = validateWorkflow.indexOf(fullReleaseGuard);
  const eventCaseOffset = validateWorkflow.indexOf(
    'case "${EVENT_NAME}" in',
  );

  assert.match(validateWorkflow, /REF_NAME: \$\{\{ github\.ref \}\}/);
  assert.ok(guardOffset >= 0, "Missing main release full-validation guard");
  assert.ok(
    guardOffset < eventCaseOffset,
    "Main release guard must run before path-aware event classification",
  );
  assert.match(
    validateWorkflow.slice(guardOffset, eventCaseOffset),
    /\.\/scripts\/classify-ci-paths\.sh \\\n\s+"\.github\/workflows\/validate\.yml"[\s\S]*exit 0/,
  );
});

test("should_gateEachRequiredJobWithItsMatchingChangeOutput", () => {
  const outputByJob = new Map([
    ["infrastructure", "infrastructure"],
    ["backend", "backend"],
    ["frontend", "frontend"],
    ["api-image", "api_image"],
    ["web-image", "web_image"],
  ]);

  for (const [jobId, expectedOutput] of outputByJob) {
    const job = workflowJob(validateWorkflow, jobId);
    const outputReferences = [
      ...job.matchAll(/needs\.changes\.outputs\.([a-z_]+)/g),
    ].map((match) => match[1]);

    assert.match(
      job,
      new RegExp(
        `needs\\.changes\\.outputs\\.${expectedOutput} != 'true'`,
      ),
    );
    assert.match(
      job,
      new RegExp(
        `needs\\.changes\\.outputs\\.${expectedOutput} == 'true'`,
      ),
    );
    assert.deepEqual(
      [...new Set(outputReferences)],
      [expectedOutput],
      `${jobId} must not reference another change output`,
    );

    const gatedSteps = job
      .split(/^      - name: /m)
      .slice(1)
      .filter(
        (step) =>
          !step.startsWith("Fail when change detection fails\n") &&
          !step.startsWith("Skip unrelated"),
      );

    assert.ok(gatedSteps.length > 0, `${jobId} must have gated work`);
    for (const step of gatedSteps) {
      const stepName = step.slice(0, step.indexOf("\n"));

      assert.match(
        step,
        new RegExp(
          `^        if: .*needs\\.changes\\.outputs\\.${expectedOutput} == 'true'`,
          "m",
        ),
        `${jobId}/${stepName} must use ${expectedOutput}`,
      );
    }
  }
});

test("should_runOnlyFrontendChecks_when_frontendSourceChanges", () => {
  assert.deepEqual(classifyPaths(["frontend/src/App.tsx"]), {
    backend: "false",
    frontend: "true",
    infrastructure: "false",
    api_image: "false",
    web_image: "true",
  });
});

test("should_runInfrastructureAndFrontendChecks_when_frontendDockerfileChanges", () => {
  assert.deepEqual(classifyPaths(["frontend/Dockerfile"]), {
    backend: "false",
    frontend: "true",
    infrastructure: "true",
    api_image: "false",
    web_image: "true",
  });
});

test("should_runOnlyBackendChecks_when_backendSourceChanges", () => {
  assert.deepEqual(classifyPaths(["backend/src/main/java/App.java"]), {
    backend: "true",
    frontend: "false",
    infrastructure: "false",
    api_image: "true",
    web_image: "false",
  });
});

test("should_runInfrastructureBackendAndApiImage_when_backendDockerfileChanges", () => {
  assert.deepEqual(classifyPaths(["backend/Dockerfile"]), {
    backend: "true",
    frontend: "false",
    infrastructure: "true",
    api_image: "true",
    web_image: "false",
  });
});

test("should_runInfraAndFrontendImage_when_nginxChanges", () => {
  assert.deepEqual(classifyPaths(["infra/nginx/default.conf"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "true",
    api_image: "false",
    web_image: "true",
  });
});

test("should_runOnlyInfrastructureChecks_when_operationsDocsChange", () => {
  assert.deepEqual(classifyPaths(["docs/OPERATIONS.md"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "true",
    api_image: "false",
    web_image: "false",
  });
});

test("should_runOnlyInfrastructureChecks_when_launchAgentChanges", () => {
  assert.deepEqual(
    classifyPaths([
      "launchd/com.homeserver.guess-pokemon-backup.plist.example",
    ]),
    {
      backend: "false",
      frontend: "false",
      infrastructure: "true",
      api_image: "false",
      web_image: "false",
    },
  );
});

test("should_runOnlyInfrastructureChecks_when_runtimeConfigImageChanges", () => {
  assert.deepEqual(classifyPaths(["runtime-config.Dockerfile"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "true",
    api_image: "false",
    web_image: "false",
  });
});

test("should_runBothScopes_when_fileMovesFromFrontendToBackend", () => {
  assert.deepEqual(
    classifyPaths(["frontend/src/old.ts", "backend/src/main/java/New.java"]),
    {
      backend: "true",
      frontend: "true",
      infrastructure: "false",
      api_image: "true",
      web_image: "true",
    },
  );
});

test("should_preserveNonAsciiPath_when_frontendFileChanges", () => {
  assert.deepEqual(classifyPaths(["frontend/src/포켓몬.ts"]), {
    backend: "false",
    frontend: "true",
    infrastructure: "false",
    api_image: "false",
    web_image: "true",
  });
});

test("should_skipExpensiveChecks_when_unrelatedMetadataChanges", () => {
  assert.deepEqual(classifyPaths(["AGENTS.md"]), {
    backend: "false",
    frontend: "false",
    infrastructure: "false",
    api_image: "false",
    web_image: "false",
  });
});

test("should_runEveryCheck_when_gitAttributesChangeCheckoutPolicy", () => {
  assert.deepEqual(classifyPaths([".gitattributes"]), {
    backend: "true",
    frontend: "true",
    infrastructure: "true",
    api_image: "true",
    web_image: "true",
  });
});

test("should_runEveryCheck_when_unclassifiedRuntimePathChanges", () => {
  assert.deepEqual(classifyPaths(["new-runtime/tool.toml"]), {
    backend: "true",
    frontend: "true",
    infrastructure: "true",
    api_image: "true",
    web_image: "true",
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
      api_image: "true",
      web_image: "true",
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

test("should_validateThenPublishBothShaImagesOnlyFromMain", () => {
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
  assert.match(
    deployWorkflow,
    /validate:\n    name: Validate release[\s\S]*uses: \.\/\.github\/workflows\/validate\.yml/,
  );
  assert.match(
    workflowJob(deployWorkflow, "publish"),
    /^    needs:\n      - validate/m,
  );
  assert.doesNotMatch(deployWorkflow, /docker\/setup-qemu-action/);
  assert.doesNotMatch(deployWorkflow, /:latest|:main/);
  assert.equal(
    deployWorkflow.match(
      /if: github\.ref == 'refs\/heads\/main' && vars\.MAC_MINI_DEPLOY_ENABLED == 'true'/g,
    )?.length,
    2,
  );
  assert.match(
    deployWorkflow,
    /needs:\n      - publish[\s\S]*packages: read[\s\S]*id-token: write/,
  );
});

test("should_updateDeployedBaselineOnly_when_productionDeploymentSucceeded", () => {
  const deployedBaseStep = deployWorkflow.match(
    /- name: Resolve last successful production revision[\s\S]*?(?=\n      - name: Detect runtime config changes)/,
  )?.[0];

  assert.ok(deployedBaseStep);
  assert.match(
    deployedBaseStep,
    /deployed_sha=0{40}[\s\S]*while IFS=\$'\\t' read -r deployment_id deployment_candidate_sha; do/,
  );
  assert.match(
    deployedBaseStep,
    /if \[\[ "\$\{state\}" == success \]\]; then\s+deployed_sha="\$\{deployment_candidate_sha\}"/,
  );
  assert.doesNotMatch(
    deployedBaseStep,
    /read -r deployment_id deployment_sha/,
  );
});

test("should_pinEveryExternalWorkflowActionToExpectedFullSha", () => {
  const expectedActionPins = new Map([
    [
      "actions/cache",
      "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
    ],
    [
      "actions/checkout",
      "d23441a48e516b6c34aea4fa41551a30e30af803",
    ],
    [
      "docker/build-push-action",
      "53b7df96c91f9c12dcc8a07bcb9ccacbed38856a",
    ],
    [
      "docker/login-action",
      "371161bbe7024a29a25c5e19bfcbc0804fe9ad2c",
    ],
    [
      "docker/setup-buildx-action",
      "bb05f3f5519dd87d3ba754cc423b652a5edd6d2c",
    ],
    [
      "tailscale/github-action",
      "780049a30b6ff5c378a9e7b389d15ece7a204888",
    ],
  ]);
  const externalActions = [validateWorkflow, deployWorkflow].flatMap(
    (workflow) =>
      workflowActionReferences(workflow).filter(
        (reference) => !reference.startsWith("./"),
      ),
  );

  assert.ok(externalActions.length > 0);
  for (const reference of externalActions) {
    const separator = reference.lastIndexOf("@");
    assert.ok(separator > 0, `Missing action ref: ${reference}`);
    const action = reference.slice(0, separator);
    const ref = reference.slice(separator + 1);
    assert.match(ref, /^[0-9a-f]{40}$/, `Unpinned action: ${reference}`);
    assert.equal(
      ref,
      expectedActionPins.get(action),
      `Unexpected action pin: ${reference}`,
    );
  }
  assert.deepEqual(
    [...new Set(externalActions.map((reference) => reference.split("@")[0]))]
      .sort(),
    [...expectedActionPins.keys()].sort(),
  );
});

test("should_collectWorkflowActions_when_usesKeyOrValueIsQuoted", () => {
  assert.deepEqual(
    workflowActionReferences(`
      steps:
        - "uses": owner/action@v1
        - 'uses': "owner/second-action@v2"
    `),
    ["owner/action@v1", "owner/second-action@v2"],
  );
  assert.throws(
    () =>
      workflowActionReferences(`
        steps:
          - { "uses": owner/action@v1 }
      `),
    /Unsupported uses syntax/,
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
  assert.match(restrictedWrapper, /readonly LOCKF_BIN=\/usr\/bin\/lockf/);
  assert.match(
    restrictedWrapper,
    /readonly OPERATION_LOCK="\$\{APP_DIR\}\/\.guess-pokemon-operation\.lock"/,
  );
  assert.match(restrictedWrapper, /"\$\{LOCKF_BIN\}" -s -t 0 9/);
  assert.match(restrictedWrapper, /<&3 3<&-/);
  assert.match(
    productionBackupBootstrap,
    /readonly OPERATION_LOCK="\$\{APP_DIR\}\/\.guess-pokemon-operation\.lock"/,
  );
  assert.match(productionBackupBootstrap, /"\$\{LOCKF_BIN\}" -s -t 0 9/);
  assert.match(
    productionBackupBootstrap,
    /scripts\/backup-guess-pokemon\.sh/,
  );
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
    '"${active_backup_script}"',
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
    assert.equal(composeUpCommands?.length, 4);
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

test("should_publishValidatedSnapshotsAndPlanRetentionBeforeOffsiteHandoff", () => {
  const restoreList = productionBackupScript.indexOf("pg_restore --list");
  const snapshotInventory = productionBackupScript.indexOf("--data-only");
  const snapshotInventoryCommandStart = productionBackupScript.lastIndexOf(
    "compose exec -T db pg_restore",
    snapshotInventory,
  );
  const snapshotInventoryCommandEnd = productionBackupScript.indexOf(
    '| "${PYTHON_BIN}" -c',
    snapshotInventory,
  );
  const successMarker = productionBackupScript.indexOf(
    'printf \'snapshot complete\\n\' >"${work_dir}/SUCCESS"',
  );
  const finalMove = productionBackupScript.indexOf(
    '/bin/mv "${work_dir}" "${final_dir}"',
  );
  const retention = productionBackupScript.indexOf('"mode": "dry-run"');
  const offsite = productionBackupScript.indexOf("stage_offsite_snapshot() {");

  assert.ok(restoreList >= 0);
  assert.ok(snapshotInventory > restoreList);
  assert.ok(snapshotInventoryCommandStart >= 0);
  assert.ok(snapshotInventoryCommandEnd > snapshotInventory);
  const snapshotInventoryCommand = productionBackupScript.slice(
    snapshotInventoryCommandStart,
    snapshotInventoryCommandEnd,
  );
  assert.match(snapshotInventoryCommand, /--file=-/);
  assert.match(snapshotInventoryCommand, /<"\$\{db_dump_file\}"/);
  assert.doesNotMatch(
    snapshotInventoryCommand,
    /(?:^|\s)(?:-d(?:\s|=)|--dbname(?:\s|=))/m,
  );
  assert.ok(successMarker > snapshotInventory);
  assert.ok(successMarker > restoreList);
  assert.ok(finalMove > successMarker);
  assert.ok(retention > finalMove);
  assert.ok(offsite > retention);
  assert.match(
    productionBackupScript,
    /Usage: backup-guess-pokemon\.sh \[--trigger scheduled\|predeploy\]/,
  );
  assert.match(productionBackupScript, /"schemaVersion": 1/);
  assert.match(productionBackupScript, /"status": "success"/);
  assert.match(productionBackupScript, /"engine": "postgresql"/);
  assert.match(
    productionBackupScript,
    /"recordCounts": dict\(sorted\(record_counts\.items\(\)\)\)/,
  );
  assert.match(
    productionBackupScript,
    /"recordCountsSource": "database\/dump"/,
  );
  assert.match(productionBackupScript, /--schema=public/);
  assert.match(productionBackupScript, /--strict-names/);
  assert.doesNotMatch(productionBackupScript, /BACKUP_QUERY=record-counts/);
  assert.match(
    productionBackupScript,
    /"policy": \{"recent": 4, "dailyAtOrAfterKst": "06:00", "dailyDays": 7\}/,
  );
  assert.match(productionBackupScript, /"\$\{AGE_BIN\}" -R "\$\{AGE_RECIPIENT_FILE\}"/);
  assert.match(productionBackupScript, /\.XXXXXX\.partial/);
  assert.match(productionBackupScript, /iCloud handoff checksum mismatch/);
  assert.match(productionBackupScript, /age recipient file mode must be 600/);
  assert.match(
    productionBackupScript,
    /prepare_private_directory "\$\{BACKUP_DIR\}"/,
  );
  assert.match(
    productionBackupScript,
    /readonly HEARTBEAT_CONFIG_FILE="\$\{APP_DIR\}\/backup-heartbeats\.conf"/,
  );
  assert.match(
    productionBackupScript,
    /backup heartbeat configuration mode must be 600/,
  );
  assert.match(
    productionBackupScript,
    /backup heartbeat configuration contains unexpected content/,
  );
  assert.match(productionBackupScript, /Backup heartbeat delivery failed: %s/);
  assert.doesNotMatch(
    productionBackupScript,
    /rm -rf|find[^\n]*-delete|down[^\n]*(?:--volumes|-v)/,
  );
});

test("should_runOneShotFlywayBeforeCutoverAndGateSuccessOnPublicSmoke", () => {
  const migrationFunction = deployScript.match(
    /run_one_shot_migration\(\) \{[\s\S]*?\n\}/,
  )?.[0];
  const pending = deployScript.lastIndexOf("write_pending_state \\");
  const migration = deployScript.lastIndexOf(
    'if ! run_one_shot_migration "${new_api_image}" "${new_web_image}"; then',
  );
  const imageWrite = deployScript.lastIndexOf(
    'write_image_env "${new_api_image}" "${new_web_image}"',
  );
  const publicSmoke = deployScript.lastIndexOf("if public_smoke; then");
  const successState = deployScript.lastIndexOf("write_success_state \\");

  assert.match(productionCompose, /SPRING_FLYWAY_ENABLED: "false"/);
  assert.ok(migrationFunction);
  assert.match(
    migrationFunction,
    /-Dloader\.main=\$\{MIGRATION_MAIN_CLASS\}[\s\S]*PropertiesLauncher/,
  );
  assert.match(migrationFunction, /local candidate_api_image="\$1"/);
  assert.match(migrationFunction, /local candidate_web_image="\$2"/);
  assert.match(migrationFunction, /export API_IMAGE="\$\{candidate_api_image\}"/);
  assert.match(migrationFunction, /export WEB_IMAGE="\$\{candidate_web_image\}"/);
  assert.match(migrationFunction, /compose run \\\n[\s\S]*--pull never/);
  assert.ok(pending >= 0);
  assert.ok(migration > pending);
  assert.ok(imageWrite > migration);
  assert.ok(publicSmoke > imageWrite);
  assert.ok(successState > publicSmoke);
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
  assert.match(
    operations,
    /최근 정상 snapshot 4개와 지난 7 calendar day마다 KST 06:00 이후 첫 정상/,
  );
  assert.match(operations, /현재 worker는 실제 삭제 없이\s+dry-run만 수행한다/);
  assert.match(
    operations,
    /candidate API image의 `MigrationMain`을 one-shot으로 실행해 Flyway/,
  );
  assert.match(
    operations,
    /public Web `\/`, deep link `\/history`, API readiness/,
  );
  assert.match(operations, /DB migration은 자동으로 rollback하지 않는다/);
  assert.match(deployScript, /readonly PYTHON_BIN=\/usr\/bin\/python3/);
  assert.match(productionBackupScript, /readonly PROJECT_NAME=guess-pokemon/);
  assert.match(operations, /test -x \/usr\/bin\/python3/);
  assert.match(operations, /\/usr\/bin\/python3 --version/);
  assert.match(
    operations,
    /docker compose config --help[\s\S]*--no-env-resolution/,
  );
  assert.match(
    operations,
    /마지막 성공 Production deployment[\s\S]*변경된 배포만[\s\S]*runtime-config/,
  );
  assert.match(
    operations,
    /이전 API·Web SHA와 runtime\s+config를 함께 복구하고 public smoke를 다시 확인한다/,
  );
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
  assert.match(deployScript, /required service is missing/);
  assert.match(deployScript, /Compose service set is invalid/);
  assert.match(deployScript, /Compose network set is invalid/);
  assert.match(deployScript, /Compose top-level volume set is invalid/);
  assert.match(deployScript, /API service must not mount volumes/);
  assert.match(deployScript, /must not publish host ports/);
  assert.match(deployScript, /must not add host privileges or devices/);
  assert.match(
    deployScript,
    /for field in \("volumes_from", "configs", "secrets", "env_file"\)/,
  );
  assert.match(deployScript, /must not use \{field\}/);
  assert.match(
    deployScript,
    /for field in \("extra_hosts", "external_links", "links"\)/,
  );
  assert.match(deployScript, /must not override service discovery/);
  assert.match(deployScript, /contains an unapproved host bind/);
  assert.match(deployScript, /PostgreSQL persistent volume contract is invalid/);
  assert.match(
    deployScript,
    /database storage environment differs from the active verified configuration/,
  );
  assert.match(
    deployScript,
    /API data configuration differs from the active verified configuration/,
  );
  assert.match(deployScript, /must not override the image \{field\}/);
  assert.match(deployScript, /SPRING_APPLICATION_JSON/);
  assert.match(deployScript, /JAVA_TOOL_OPTIONS/);
  assert.match(
    deployScript,
    /key\.upper\(\)\.replace\("\.", "_"\)\.replace\("-", "_"\)/,
  );
  assert.match(
    deployScript,
    /environment variable names collide after relaxed binding normalization/,
  );
  assert.match(deployScript, /for lifecycle_hook in \("post_start", "pre_stop"\)/);
  assert.match(
    deployScript,
    /healthcheck probe is invalid/,
  );
  assert.match(
    deployScript,
    /healthcheck test differs from the active verified configuration/,
  );
  assert.match(
    deployScript,
    /user differs from the active verified configuration/,
  );
  assert.match(
    deployScript,
    /tmpfs target set differs from the active verified configuration/,
  );
  assert.match(deployScript, /web edge alias set is invalid/);
  assert.match(
    deployScript,
    /deployment did not start every required service/,
  );
  assert.doesNotMatch(
    deployScript,
    /restart policy must remain|logging rotation contract is invalid|API environment key allowlist is invalid/,
  );
  assert.match(
    runtimeConfigDetector,
    /\.dockerignore[\s\S]*compose\.production\.yaml[\s\S]*infra\/nginx\/cloudflare-edge-real-ip\.conf[\s\S]*runtime-config\.Dockerfile[\s\S]*scripts\/backup-production-db\.sh[\s\S]*scripts\/deploy-guess-pokemon\.sh/,
  );
  assert.match(
    runtimeConfigDockerfile,
    /FROM scratch[\s\S]*COPY compose\.production\.yaml \/runtime\/compose\.yaml[\s\S]*COPY infra\/nginx\/cloudflare-edge-real-ip\.conf[\s\S]*COPY --chmod=0700 scripts\/deploy-guess-pokemon\.sh \/runtime\/scripts\/deploy-guess-pokemon\.sh[\s\S]*COPY --chmod=0700 scripts\/backup-production-db\.sh \/runtime\/scripts\/backup-guess-pokemon\.sh/,
  );
  assert.match(deployScript, /candidate runtime config must contain deploy and backup scripts/);
  assert.match(deployScript, /active_backup_script="\$\{candidate_release\}\/scripts\/backup-guess-pokemon\.sh"/);
  assert.match(productionBackupScript, /scripts\/backup-guess-pokemon\.sh/);

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

function workflowActionReferences(workflow) {
  const possibleUsesKey = /(?:^|[\s{,-])(?:"uses"|'uses'|uses)\s*:/;

  return workflow.split("\n").flatMap((line) => {
    if (line.trimStart().startsWith("#") || !possibleUsesKey.test(line)) {
      return [];
    }
    const match =
      /^\s*(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))(?:\s+#.*)?\s*$/.exec(
        line,
      );
    assert.ok(match, `Unsupported uses syntax: ${line.trim()}`);
    return [match[1] ?? match[2] ?? match[3]];
  });
}
