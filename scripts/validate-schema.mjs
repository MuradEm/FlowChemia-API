// Prisma's packaged WASM validator works without downloading native engines.
import internals from '@prisma/internals';
import { readFile } from 'node:fs/promises';

const datamodel = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const result = await internals.getDMMF({ datamodel });
console.log(`Validated ${result.datamodel.models.length} database models.`);
