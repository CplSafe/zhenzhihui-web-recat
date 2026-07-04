import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const envFilePath = path.join(projectRoot, '.env.local');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const values = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

const envFromFile = loadEnvFile(envFilePath);

function getEnv(name) {
  return process.env[name] ?? envFromFile[name] ?? '';
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function requireValue(value, message) {
  if (!value) {
    console.error(message);
    process.exit(1);
  }

  return value;
}

async function figmaRequest(apiPath, searchParams = {}) {
  const apiKey = requireValue(
    getEnv('FIGMA_API_KEY'),
    '缺少 FIGMA_API_KEY。请在 .env.local 中配置后重试。'
  );

  const url = new URL(`https://api.figma.com/v1${apiPath}`);

  for (const [key, value] of Object.entries(searchParams)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': apiKey,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    console.error(`Figma API 请求失败: ${response.status} ${response.statusText}`);
    console.error(text);
    process.exit(1);
  }

  return JSON.parse(text);
}

function writeOutput(data, outputPath) {
  const content = JSON.stringify(data, null, 2);
  if (!outputPath) {
    console.log(content);
    return;
  }

  const fullPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(projectRoot, outputPath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `${content}\n`, 'utf8');
  console.log(`已写入 ${fullPath}`);
}

async function handleFile(args) {
  const fileKey = requireValue(
    args.file ?? getEnv('FIGMA_FILE_KEY'),
    '缺少 file key。请传 --file 或在 .env.local 中配置 FIGMA_FILE_KEY。'
  );

  const data = await figmaRequest(`/files/${fileKey}`, {
    ids: args.ids,
    depth: args.depth,
  });

  writeOutput(data, args.output);
}

async function handleNode(args) {
  const fileKey = requireValue(
    args.file ?? getEnv('FIGMA_FILE_KEY'),
    '缺少 file key。请传 --file 或在 .env.local 中配置 FIGMA_FILE_KEY。'
  );
  const nodeId = requireValue(
    args.node,
    '缺少 node id。请通过 --node 传入，例如 --node 12:34。'
  );

  const data = await figmaRequest(`/files/${fileKey}/nodes`, {
    ids: nodeId,
    depth: args.depth,
  });

  writeOutput(data, args.output);
}

async function handleImage(args) {
  const fileKey = requireValue(
    args.file ?? getEnv('FIGMA_FILE_KEY'),
    '缺少 file key。请传 --file 或在 .env.local 中配置 FIGMA_FILE_KEY。'
  );
  const nodeId = requireValue(
    args.node,
    '缺少 node id。请通过 --node 传入，例如 --node 12:34。'
  );

  const data = await figmaRequest(`/images/${fileKey}`, {
    ids: nodeId,
    format: args.format ?? 'png',
    scale: args.scale ?? '2',
  });

  writeOutput(data, args.output);
}

async function main() {
  const [command, ...restArgs] = process.argv.slice(2);
  const args = parseArgs(restArgs);

  switch (command) {
    case 'file':
      await handleFile(args);
      break;
    case 'node':
      await handleNode(args);
      break;
    case 'image':
      await handleImage(args);
      break;
    default:
      console.log(`用法:
  npm run figma:file -- --file <fileKey> --output tmp/figma-file.json
  npm run figma:node -- --node <nodeId> --output tmp/figma-node.json
  npm run figma:image -- --node <nodeId> --format png --scale 2

可选环境变量:
  FIGMA_API_KEY=...
  FIGMA_FILE_KEY=...`);
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
