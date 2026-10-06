require('dotenv').config({quiet:true});
const {PrismaClient}=require('../src/generated/prisma');
const {PrismaPg}=require('@prisma/adapter-pg');
const url=new URL(process.env.DATABASE_URL);
url.pathname='/manualtest_sandbox_presentation';
const p=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})});
Promise.all([p.tenant.findMany({select:{slug:true,name:true}}),p.mission.count(),p.plan.count(),p.user.findMany({select:{email:true,role:true}})]).then(console.log).finally(()=>p.$disconnect());
