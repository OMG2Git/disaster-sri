import { writeFile } from 'node:fs/promises';
import { openApiSpec } from '../openapi.js';

// Writes docs/openapi.json (importable into Postman, Insomnia, Swagger Editor...).
await writeFile(new URL('../../docs/openapi.json', import.meta.url), JSON.stringify(openApiSpec, null, 2) + '\n');
console.log('wrote docs/openapi.json');
