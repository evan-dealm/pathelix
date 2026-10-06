require('dotenv').config({quiet:true});
const {Client}=require('pg');
const {spawnSync}=require('child_process');
const fs=require('fs');
async function main(){
  const url=new URL(process.env.DATABASE_URL);
  if(url.hostname!=='localhost') throw new Error('Local only');
  const client=new Client({connectionString:url.toString()});
  await client.connect();
  const exists=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',['manualtest_sandbox_presentation']);
  if(!exists.rowCount) await client.query('CREATE DATABASE manualtest_sandbox_presentation');
  await client.end();
  url.pathname='/manualtest_sandbox_presentation';
  process.env.DATABASE_URL=url.toString();
  const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:process.env,stdio:'inherit'});
  if(result.status!==0) throw new Error('Migration failed');
  process.env.PRESENTATION_PASSWORD='DemoMotion2026!';
  const seed=spawnSync(process.execPath,['scripts/seed-presentation.cjs'],{env:process.env,stdio:'inherit'});
  if(seed.status!==0) throw new Error('Seed failed');
  console.log('Presentation database ready.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
