const {spawn}=require('child_process');
const fs=require('fs');
const child=spawn(process.execPath,['tmp/presentation-server.cjs'],{
  cwd:process.cwd(),detached:true,windowsHide:true,
  stdio:['ignore',fs.openSync('tmp/presentation-server.log','a'),fs.openSync('tmp/presentation-server-error.log','a')]
});
child.unref();
console.log('Presentation server process:',child.pid);
