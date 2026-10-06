require('dotenv').config({quiet:true});
const {spawn}=require('child_process');
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='localhost') throw new Error('Local only');
url.pathname='/manualtest_sandbox_presentation';
Object.assign(process.env,{DATABASE_URL:url.toString(),USE_MOCK_DATA:'false',NODE_ENV:'development',FORCE_HTTPS:'false',REDIS_DISABLED:'true',NEXTAUTH_URL:'http://localhost:3001'});
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3001','-H','127.0.0.1'],{env:process.env,stdio:'inherit'});
server.on('exit',code=>process.exit(code??0));
