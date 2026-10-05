import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const usage = 'Usage: validate-prebuilt-image-archive.mjs [--config-digest|--identity-digests] <archive.tar.gz> <expected-image> [expected-config-digest] [expected-oci-manifest-digest]';

function readTarMember(archive, member) {
  try {
    return execFileSync('tar', ['-xOzf', archive, '--', member], {
      encoding: null,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim();
    throw new Error(`Unable to read ${member} from ${archive}${detail ? `: ${detail}` : ''}`);
  }
}

function listTarMembers(archive) {
  try {
    return new Set(execFileSync('tar', ['-tzf', archive], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).split(/\r?\n/u).filter(Boolean).map((member) => member.replace(/^\.\//u, '')));
  } catch (error) {
    const detail = error.stderr?.toString('utf8').trim();
    throw new Error(`Unable to list ${archive}${detail ? `: ${detail}` : ''}`);
  }
}

function readOciManifestDigest(archive, configDigest) {
  if (!listTarMembers(archive).has('index.json')) return null;

  let index;
  try {
    index = JSON.parse(readTarMember(archive, 'index.json').toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid OCI index in ${archive}: ${error.message}`);
  }
  if (!Array.isArray(index.manifests) || index.manifests.length !== 1) {
    throw new Error(`Expected exactly one OCI manifest in ${archive}`);
  }

  const digest = index.manifests[0]?.digest;
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`Invalid OCI manifest digest in ${archive}`);
  }
  const manifestBytes = readTarMember(archive, `blobs/sha256/${digest.slice('sha256:'.length)}`);
  const actualDigest = `sha256:${crypto.createHash('sha256').update(manifestBytes).digest('hex')}`;
  if (actualDigest !== digest) throw new Error(`OCI manifest SHA256 mismatch in ${archive}`);

  let ociManifest;
  try {
    ociManifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error(`OCI manifest JSON is invalid in ${archive}`);
  }
  if (ociManifest.config?.digest !== configDigest) {
    throw new Error(`OCI manifest Config digest does not match docker-save manifest in ${archive}`);
  }
  return digest;
}

function readMetadata(archive) {
  if (!fs.statSync(archive).isFile()) throw new Error(`Archive is not a regular file: ${archive}`);

  let manifest;
  try {
    manifest = JSON.parse(readTarMember(archive, 'manifest.json').toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid docker-save manifest in ${archive}: ${error.message}`);
  }
  if (!Array.isArray(manifest) || manifest.length !== 1) {
    throw new Error(`Expected exactly one manifest entry in ${archive}`);
  }

  const entry = manifest[0];
  const configPath = entry?.Config;
  if (typeof configPath !== 'string' || !configPath || path.posix.isAbsolute(configPath) || configPath.split('/').includes('..')) {
    throw new Error(`Invalid Config path in ${archive}`);
  }
  if (!Array.isArray(entry.RepoTags) || entry.RepoTags.some((tag) => typeof tag !== 'string')) {
    throw new Error(`Invalid RepoTags in ${archive}`);
  }

  const config = readTarMember(archive, configPath);
  let configJson;
  try {
    configJson = JSON.parse(config.toString('utf8'));
  } catch {
    throw new Error(`Config JSON is invalid in ${archive}`);
  }

  const configDigest = `sha256:${crypto.createHash('sha256').update(config).digest('hex')}`;
  return {
    repoTags: entry.RepoTags,
    configDigest,
    ociManifestDigest: readOciManifestDigest(archive, configDigest),
    os: configJson.os,
    architecture: configJson.architecture,
  };
}

function validate(archive, expectedImage, expectedConfigDigest, expectedOciManifestDigest) {
  const metadata = readMetadata(archive);
  if (metadata.repoTags.length !== 1 || metadata.repoTags[0] !== expectedImage) {
    throw new Error(`Archive RepoTags do not exactly match manifest image ${expectedImage}: ${archive}`);
  }
  if (metadata.os !== 'linux' || metadata.architecture !== 'amd64') {
    throw new Error(`Archive platform is not linux/amd64 for ${expectedImage}: ${metadata.os}/${metadata.architecture}`);
  }
  if (expectedConfigDigest && metadata.configDigest !== expectedConfigDigest) {
    throw new Error(`Archive Config SHA256 does not match immutable artifact manifest for ${expectedImage}`);
  }
  if (expectedOciManifestDigest && metadata.ociManifestDigest !== expectedOciManifestDigest) {
    throw new Error(`Archive OCI manifest SHA256 does not match immutable artifact manifest for ${expectedImage}`);
  }
  return metadata;
}

const args = process.argv.slice(2);
const printConfigDigest = args[0] === '--config-digest';
const printIdentityDigests = args[0] === '--identity-digests';
const values = printConfigDigest || printIdentityDigests ? args.slice(1) : args;
if (
  ((printConfigDigest || printIdentityDigests) && values.length !== 2)
  || (!printConfigDigest && !printIdentityDigests && ![3, 4].includes(values.length))
) {
  throw new Error(usage);
}

const [archive, expectedImage, expectedConfigDigest, expectedOciManifestDigest] = values;
const metadata = validate(archive, expectedImage, expectedConfigDigest, expectedOciManifestDigest);
if (printConfigDigest) process.stdout.write(`${metadata.configDigest}\n`);
if (printIdentityDigests) {
  if (!metadata.ociManifestDigest) throw new Error(`Archive does not contain an OCI manifest digest: ${archive}`);
  process.stdout.write(`${metadata.configDigest}\t${metadata.ociManifestDigest}\n`);
}
