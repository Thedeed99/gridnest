import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const load = async relative => readFile(new URL(relative, import.meta.url), 'utf8');

test('Gridnest metadata, pakketversie en containerlabel komen overeen', async () => {
  const config = parse(await load('../config.yaml'));
  const repository = parse(await load('../../repository.yaml'));
  const pkg = JSON.parse(await load('../package.json'));
  const lock = JSON.parse(await load('../package-lock.json'));
  const dockerfile = await load('../Dockerfile');
  assert.equal(repository.name, 'Gridnest');
  assert.equal(config.name, 'Gridnest');
  assert.equal(config.slug, 'gridnest');
  assert.equal(pkg.name, 'gridnest');
  assert.equal(config.version, '0.1.2');
  assert.equal(config.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.ok(dockerfile.includes(`ARG BUILD_VERSION=${config.version}`));
  assert.deepEqual(config.arch, ['amd64', 'aarch64']);
});

test('add-on gebruikt Ingress zonder extra privileges of hostpoorten', async () => {
  const config = parse(await load('../config.yaml'));
  assert.equal(config.ingress, true);
  assert.equal(config.ingress_port, 8080);
  assert.equal(config.homeassistant_api, true);
  assert.equal(config.apparmor, true);
  assert.equal(config.stage, 'experimental');
  for (const key of ['ports', 'host_network', 'full_access', 'privileged', 'docker_api', 'hassio_api']) assert.equal(config[key], undefined);
});

test('publicatieworkflow gebruikt gelijknamige image en beide architecturen', async () => {
  const workflow = parse(await load('../../.github/workflows/container.yaml'));
  assert.equal(workflow.jobs.container.if, "startsWith(github.ref, 'refs/tags/v')");
  const steps = workflow.jobs.container.steps;
  const metadata = steps.find(step => step.id === 'meta');
  const build = steps.find(step => step.uses === 'docker/build-push-action@v6');
  const smokeSteps = workflow.jobs.smoke.steps;
  const supervisorRun = smokeSteps.find(step => step.name === 'Run isolated Supervisor-mode container');
  const supervisorCheck = smokeSteps.find(step => step.name === 'Check root-only options and non-root server');
  assert.equal(metadata.with.images, 'ghcr.io/${{ github.repository }}');
  assert.equal(build.with.platforms, 'linux/amd64,linux/arm64');
  assert.equal(build.with.push, "${{ github.event_name != 'pull_request' }}");
  assert.match(supervisorRun.run, /target=\/data\/options\.json,readonly/);
  assert.doesNotMatch(supervisorRun.run, /\s-p\s/);
  assert.match(supervisorCheck.run, /CONTROL_ENABLED=true/);
});

test('echte sturing is standaard uit in de appconfiguratie en heeft een Nederlandse optie', async () => {
  const config = parse(await load('../config.yaml'));
  const translation = parse(await load('../translations/nl.yaml'));
  assert.equal(config.options.allow_control, false);
  assert.equal(config.schema.allow_control, 'bool');
  assert.equal(translation.configuration.allow_control.name, 'Echte apparaatsturing vrijgeven');
});

test('publicatie wacht op container-smoke-tests voor beide architecturen', async () => {
  const workflow = parse(await load('../../.github/workflows/container.yaml'));
  assert.deepEqual(workflow.jobs.container.needs, ['test', 'smoke']);
  assert.deepEqual(workflow.jobs.smoke.strategy.matrix.platform, ['linux/amd64', 'linux/arm64']);
});