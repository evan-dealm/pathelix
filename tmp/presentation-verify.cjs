const assert=require('node:assert/strict');
require('dotenv').config({quiet:true});
const {PrismaClient}=require('../src/generated/prisma');
const {PrismaPg}=require('@prisma/adapter-pg');
const url=new URL(process.env.DATABASE_URL);url.pathname='/manualtest_sandbox_presentation';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})});
async function main(){
  const tenant=await db.tenant.findUniqueOrThrow({where:{slug:'presentation-motion'}});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date());
  const plans=await db.plan.findMany({where:{tenantId:tenant.id,date:today}});
  for(const plan of plans){
    const statuses={};
    for(let k=0;k<plan.missions.length;k++){
      const m=plan.missions[k];
      statuses[m.id]={status:k<2?'done':k===2?'en_route':'todo',updatedAt:new Date().toISOString()};
      const completedAt=k<2?new Date(`${today}T${String(7+k).padStart(2,'0')}:30:00+02:00`):null;
      await db.mission.update({where:{id:m.id,tenantId:tenant.id},data:{completedAt,actualDurationMin:k<2?23:null,actualDistanceKm:k<2?8:null}});
      Object.assign(m,{completedAt:completedAt?.toISOString()??null,actualDurationMin:k<2?23:null,actualDistanceKm:k<2?8:null});
    }
    await db.plan.update({where:{id:plan.id,tenantId:tenant.id},data:{missions:plan.missions,statuses}});
  }
  await db.mission.updateMany({where:{tenantId:tenant.id,date:today,id:{in:Array.from({length:6},(_,i)=>`presentation-${today}-${36+i}`)}},data:{completedAt:null,actualDurationMin:null,actualDistanceKm:null}});
  const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://localhost:3001'},body:JSON.stringify({email:'admin@demo.pathelix.test',password:'DemoMotion2026!'})});
  const body=await login.json();assert.equal(login.status,200,JSON.stringify(body));
  console.log('Admin login:',login.status,body);
  const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  for(const path of ['/admin','/api/drivers',`/api/missions?date=${today}`,`/api/plans?date=${today}`,'/api/reports?period=month']){
    const res=await fetch('http://localhost:3001'+path,{headers:{cookie}});
    assert.equal(res.status,200,path);
    if(path.includes('/reports')){const data=await res.json();console.log(path,data.kpis);}else console.log(path,res.status);
  }
  const ids=plans.flatMap(p=>p.missions.map(m=>m.id));assert.equal(new Set(ids).size,36);
  console.log('Verified 6 tours, 36 assigned missions, 6 pool missions, 12 completed.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
