import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'validate-prebuilt-image-archive.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dachuan-prebuilt-image-'));

function makeArchive(name, { repoTags = ['mysql:8.0.44'], osName = 'linux', architecture = 'amd64', config = null } = {}) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  const configBytes = Buffer.from(config ?? JSON.stringify({ os: osName, architecture }), 'utf8');
  const configDigest = `sha256:${crypto.createHash('sha256').update(configBytes).digest('hex')}`;
  const ociManifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    config: { digest: configDigest },
    layers: [],
  }), 'utf8');
  const ociManifestDigest = `sha256:${crypto.createHash('sha256').update(ociManifestBytes).digest('hex')}`;
  const ociManifestPath = path.join(directory, 'blobs', 'sha256', ociManifestDigest.slice('sha256:'.length));
  fs.mkdirSync(path.dirname(ociManifestPath), { recursive: true });
  fs.writeFileSync(path.join(directory, 'config.json'), configBytes);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify([{ Config: 'config.json', RepoTags: repoTags, Layers: [] }]));
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify({
    schemaVersion: 2,
    manifests: [{ digest: ociManifestDigest }],
  }));
  fs.writeFileSync(ociManifestPath, ociManifestBytes);
  const archive = path.join(root, `${name}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', directory, 'manifest.json', 'config.json', 'index.json', 'blobs']);
  return { archive, configDigest, ociManifestDigest };
}

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

try {
  const valid = makeArchive('valid');
  const success = run(valid.archive, 'mysql:8.0.44', valid.configDigest);
  assert.equal(success.status, 0, success.stderr);
  const printedDigest = run('--config-digest', valid.archive, 'mysql:8.0.44');
  assert.equal(printedDigest.status, 0, printedDigest.stderr);
  assert.equal(printedDigest.stdout.trim(), valid.configDigest);

  const identityDigests = run('--identity-digests', valid.archive, 'mysql:8.0.44');
  assert.equal(identityDigests.status, 0, identityDigests.stderr);
  assert.equal(identityDigests.stdout.trim(), `${valid.configDigest}\t${valid.ociManifestDigest}`);
  const fullIdentity = run(valid.archive, 'mysql:8.0.44', valid.configDigest, valid.ociManifestDigest);
  assert.equal(fullIdentity.status, 0, fullIdentity.stderr);

  const wrongTag = run(valid.archive, 'mysql:8.0.45', valid.configDigest);
  assert.notEqual(wrongTag.status, 0);
  assert.match(wrongTag.stderr, /RepoTags/);

  const wrongDigest = run(valid.archive, 'mysql:8.0.44', 'sha256:0000');
  assert.notEqual(wrongDigest.status, 0);
  assert.match(wrongDigest.stderr, /Config SHA256/);

  const wrongOciManifestDigest = run(valid.archive, 'mysql:8.0.44', valid.configDigest, `sha256:${'0'.repeat(64)}`);
  assert.notEqual(wrongOciManifestDigest.status, 0);
  assert.match(wrongOciManifestDigest.stderr, /OCI manifest SHA256/);

  const wrongPlatform = makeArchive('wrong-platform', { architecture: 'arm64' });
  const platformResult = run(wrongPlatform.archive, 'mysql:8.0.44', wrongPlatform.configDigest);
  assert.notEqual(platformResult.status, 0);
  assert.match(platformResult.stderr, /linux\/amd64/);

  process.stdout.write('PREBUILT_IMAGE_ARCHIVE_VALIDATION=PASS\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
