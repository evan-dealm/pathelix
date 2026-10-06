// Dedicated, additive fictional tenant for presentation screenshots. Local DB only.
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('../src/generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const { hash } = require('bcryptjs');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/manualtest_sandbox_presentation') {
  throw new Error('This presentation seed requires the local manualtest_sandbox_presentation database.');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
const email = 'admin@demo.pathelix.test';
const password = process.env.PRESENTATION_PASSWORD;
if (!password || password.length < 12) throw new Error('Set PRESENTATION_PASSWORD (12+ characters).');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const day = n => new Date(new Date(today + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const locations = [
  ['Annecy',45.899,6.129],['Cran-Gevrier',45.909,6.106],['Seynod',45.881,6.091],
  ['Épagny',45.938,6.082],['Meythet',45.918,6.093],['Pringy',45.947,6.121],
  ['Argonay',45.944,6.145],['Annecy-le-Vieux',45.919,6.149],['Poisy',45.923,6.061],
  ['Rumilly',45.866,5.944],['Alby-sur-Chéran',45.817,6.021],['Chavanod',45.891,6.051],
  ['Saint-Jorioz',45.833,6.166],['Sevrier',45.863,6.140],['Doussard',45.776,6.220],
  ['La Balme-de-Sillingy',45.962,6.039],['Sillingy',45.946,6.034],['Groisy',46.018,6.172],
];
const names = ['Alpina Construction','Les Jardins du Lac','Atelier Boréal','Horizon Habitat','Novalys Industrie','Marché des Cimes','Les Terrasses Bleues','Menuiserie Clairbois','Écoquartier des Sources','Manufacture Aravis','Bâtisseurs du Chéran','Parc des Érables','Résidence Belvédère','Les Rives Fleuries','Atelier Montclair','Domaine des Aulnes','Les Vergers Urbains','Pôle Montagne'];
const waste = ['Gravats','Bois','DIB','Carton','Ferraille','Déchets verts'];
async function main() {
  if (await db.tenant.findUnique({where:{slug:'presentation-motion'}})) {
    console.log('Presentation tenant already exists; no existing data changed.'); return;
  }
  const passwordHash = await hash(password,12);
  await db.$transaction(async p => {
    const tenant = await p.tenant.create({data:{name:'Alpina Environnement',slug:'presentation-motion',plan:'ENTERPRISE',trade:'collecte_recyclage',contactEmail:'contact@alpina.example'}});
    const tenantId = tenant.id;
    const admin = await p.user.create({data:{tenantId,email,passwordHash,role:'ADMIN',firstName:'Camille',lastName:'Laurent'}});
    await p.tenantSettings.create({data:{tenantId,companyDisplayName:'Alpina Environnement',primaryColor:'#0055A4',defaultStartTime:'07:00',costPerKm:0.42,consumptionLPer100:29,notificationsEnabled:false,emailEnabled:false,features:{gantt:true,recurring:true,incidents:true,pdf:true},maxOptimizationsPerDay:100}});
    const drivers=[];
    const people=[['Lucas','Morel'],['Emma','Roux'],['Gabriel','Perrin'],['Léa','Fontaine'],['Hugo','Mercier'],['Jade','Bernard']];
    const colors=['#0055A4','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4'];
    for(let i=0;i<6;i++) drivers.push(await p.driver.create({data:{tenantId,firstName:people[i][0],lastName:people[i][1],sector:i<3?'Grand Annecy':'Pays du Lac',depotName:'Dépôt Épagny',depotLat:45.938,depotLng:6.082,vehicleCapacity:2,maxBinSizeM3:35,color:colors[i],skills:['permis_C','CACES'],licenseCategories:['B','C','CE'],employeeNumber:`AE-${101+i}`,email:`chauffeur${i+1}@alpina.example`,hiredAt:new Date('2022-03-01'),notes:'Profil fictif de démonstration'}}));
    const vehicles=[];
    for(let i=0;i<8;i++) vehicles.push(await p.vehicle.create({data:{tenantId,licensePlate:`DE-${210+i}-MO`,type:i===7?'grue':'ampliroll',brand:['Scania','Volvo','Renault'][i%3],model:['P410','FMX','D Wide'][i%3],capacityM3:35,maxBins:2,mileageKm:32000+i*14700,status:i===7?'maintenance':'active',assignedDriverId:drivers[i]?.id,fuelType:'diesel',year:2021+i%4,nextInspection:day(45+i*10),insuranceExpiry:day(200),lastServiceDate:day(-20-i),notes:'Véhicule fictif pour présentation'}}));
    const outlets=[];
    for(let i=0;i<3;i++) outlets.push(await p.exutoire.create({data:{tenantId,name:['Centre de valorisation Épagny','Écopôle du Chéran','Plateforme Bois & Matières'][i],address:locations[i*4][0],lat:locations[i*4][1],lng:locations[i*4][2],openingHoursOpen:420,openingHoursClose:1080,closedDays:[0],acceptedWasteTypes:waste,serviceTimeMin:20}}));
    const catalog=[];
    for(let i=0;i<18;i++) {
      const [city,latitude,longitude]=locations[i];
      const address=`${8+i*2} rue des Ateliers, ${city}`;
      const client=await p.client.create({data:{tenantId,name:names[i],contact:['Alex Martin','Lou Petit','Sacha Dubois'][i%3],email:`contact${i+1}@alpina.example`,vip:i%4===0,ecoResponsable:i%3===0,requiresBsd:i%5===0,billingAddress:address,sector:i<9?'Grand Annecy':'Pays du Lac',notes:'Entreprise et adresse fictives de démonstration',externalRef:`CLI-${100+i}`}});
      const site=await p.site.create({data:{tenantId,name:`${['Chantier','Plateforme','Atelier'][i%3]} ${city}`,address,latitude,longitude,city,zipCode:'74000',sector:client.sector,siteType:i%3===0?'chantier':'entrepot',accessNotes:['Accès par le portail principal','Prévenir le responsable à l’arrivée','Zone de dépose balisée'][i%3],openingHoursOpen:420,openingHoursClose:1020}});
      await p.clientSite.create({data:{clientId:client.id,siteId:site.id}});
      const product=await p.siteProduct.create({data:{tenantId,siteId:site.id,clientId:client.id,wasteType:waste[i%6],binSizeLabel:`Benne ${[15,20,30][i%3]} m³`,binSizeM3:[15,20,30][i%3],equipmentType:'ampliroll',defaultDurationMin:20,defaultExutoireId:outlets[i%3].id}});
      catalog.push({client,site,product});
    }
    let total=0;
    for(let offset=-42;offset<=6;offset++) {
      const date=day(offset), weekend=[0,6].includes(new Date(date+'T12:00:00Z').getDay());
      if(weekend && offset!==0) continue;
      const count=offset===0?42:offset>0?30:24+((offset+42)%5)*3;
      const rows=[];
      for(let j=0;j<count;j++) {
        const c=catalog[(j+Math.abs(offset)*3)%18];
        const finished=offset<0 || offset===0 && j<12;
        const doneAt=new Date(`${date}T${String(7+Math.floor(j/6)).padStart(2,'0')}:30:00+02:00`);
        rows.push({id:`presentation-${date}-${j}`,tenantId,type:['POSER','ECHANGER','RETIRER','ECHANGER','CHARGER_IMMEDIAT','DEPLACER'][j%6],date,clientName:c.client.name,clientId:c.client.id,siteId:c.site.id,productId:c.product.id,address:c.site.address,latitude:c.site.latitude+(Math.floor(j/18)*0.001),longitude:c.site.longitude,estimatedDurationMin:15+j%4*5,maneuverTimeMin:5,wasteTypeLabel:c.product.wasteType,binSize:String(c.product.binSizeM3),binSizeM3:c.product.binSizeM3,equipmentType:'ampliroll',priority:j%11===0?1:j%3===0?2:3,linkedExutoireId:outlets[j%3].id,timeWindowOpenMin:420,timeWindowCloseMin:j%11===0?720:1020,notes:['Accès confirmé avec le responsable de site','Rotation prévue — benne de remplacement disponible','Collecte sélective, zone de dépôt identifiée'][j%3],tags:j%11===0?['Urgent']:j%4===0?['Contrat annuel']:[],externalRef:`AE-${date.replaceAll('-','')}-${String(j+1).padStart(3,'0')}`,completedAt:finished?doneAt:null,actualDurationMin:finished?18+j%5*3:null,actualDistanceKm:finished?5+j%12:null,createdAt:offset<=0?new Date(`${date}T05:00:00Z`):new Date()});
      }
      await p.mission.createMany({data:rows}); total+=count;
      const snapshots=[];
      for(let d=0;d<6;d++) {
        const assigned=rows.filter((_,j)=>j%6===d && !(offset===0 && j>=36));
        const missions=assigned.map((m,k)=>({...m,sequenceOrder:k+1,timeWindow:{openMin:m.timeWindowOpenMin,closeMin:m.timeWindowCloseMin}}));
        const statuses=Object.fromEntries(assigned.map((m,k)=>[m.id,{status:offset<0?'done':offset===0?(k<2?'done':k===2?'en_route':'todo'):'todo',updatedAt:new Date().toISOString()}]));
        await p.plan.create({data:{tenantId,driverId:drivers[d].id,date,missions:JSON.parse(JSON.stringify(missions)),statuses,startTime:'07:00',estimatedDistanceKm:65+d*12+Math.abs(offset)%11,estimatedDurationMin:280+d*15,actualDistanceKm:offset<0?61+d*11:null,actualDurationMin:offset<0?265+d*13:null,optimizationScore:91+d,createdAt:offset<=0?new Date(`${date}T05:30:00Z`):new Date()}});
        snapshots.push({driverId:drivers[d].id,driverName:`${drivers[d].firstName} ${drivers[d].lastName}`,missions,missionCount:missions.length});
      }
      if(offset>=-7 && offset<=0) await p.tourHistory.create({data:{tenantId,date,label:offset===0?'Planning du jour — 6 tournées coordonnées':'Journée clôturée — collecte & valorisation',snapshot:JSON.stringify(snapshots)}});
    }
    for(let i=0;i<6;i++) {
      const pos=locations[i*2];
      await p.driverPosition.create({data:{tenantId,driverId:drivers[i].id,latitude:pos[1],longitude:pos[2],accuracy:8,speedKmh:0,heading:i*55,recordedAt:new Date()}});
      for(let w=0;w<5;w++) await p.fuelRecord.create({data:{tenantId,vehicleId:vehicles[i].id,driverId:drivers[i].id,liters:110+i*8+w*3,costEur:(110+i*8+w*3)*1.72,pricePerLiter:1.72,mileageKm:vehicles[i].mileageKm-w*380,stationName:'Station Dépôt Épagny',filledAt:day(-w*7)}});
      await p.maintenanceRecord.create({data:{tenantId,vehicleId:vehicles[i].id,type:'oil_change',description:'Révision périodique et contrôle sécurité',costEur:320+i*35,doneAt:day(-14-i),doneBy:'Atelier Alpina'}});
    }
    await p.planningNote.create({data:{tenantId,date:today,text:'Priorité aux chantiers du centre-ville avant 10 h. Rotation des bennes bois à Épagny. Équipe de réserve disponible cet après-midi.'}});
    await p.auditLog.create({data:{tenantId,userId:admin.id,action:'create',entityType:'planning',entityId:tenantId,changes:{description:'Scénario fictif de présentation prêt'}}});
    console.log(JSON.stringify({tenant:tenant.name,email,today,drivers:6,vehicles:8,clients:18,missions:total,todayMissions:42,todayTours:6}));
  },{timeout:120000});
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
