import {argumentsFor,operatorGuard,operatorDatabase} from './operator-runtime.mjs';
import {MIGRATION_ID,planRegistration,canRollback} from './migration-plan.mjs';
import {sha256} from '../functions/domain.js';
const args=argumentsFor();
const projectId=operatorGuard(args);
const {db,Timestamp}=operatorDatabase(projectId);
const rollback=args.argv.includes('--rollback');
let inspected=0,changed=0,skipped=0,guarded=0;
if(rollback) {
  let cursor=null;
  while(true) {
    let query=db.collection(`migrationReceipts/${MIGRATION_ID}/items`).orderBy('appliedAt','desc').limit(100);
    if(cursor) query=query.startAfter(cursor);
    const page=await query.get();if(page.empty)break;
    for(const receipt of page.docs) {
      inspected++;
      const data=receipt.data();
      if(data.rolledBack===true){skipped++;continue;}
      const count=await db.runTransaction(async(tx)=>{
        const snapshots=await Promise.all(data.operations.map((op)=>tx.get(db.doc(op.path))));
        if(snapshots.some((doc,index)=>!canRollback(doc.exists?doc.data():null,data.operations[index].afterHash)))return -1;
        if(!args.apply)return data.operations.length;
        data.operations.forEach((op,index)=>{if(op.before===null)tx.delete(snapshots[index].ref);else tx.set(snapshots[index].ref,op.before);});
        tx.update(receipt.ref,{rolledBack:true,rolledBackAt:Timestamp.now()});
        tx.set(db.collection('auditLogs').doc(),{action:'migration.rolled_back',actorUid:'operator-tool',actorRole:'operator',targetType:'migration',targetId:MIGRATION_ID,details:{receipt:receipt.id,operations:data.operations.length},createdAt:Timestamp.now()});
        return data.operations.length;
      });
      if(count<0)guarded++;else changed+=count;
    }
    cursor=page.docs.at(-1);if(page.size<100)break;
  }
} else {
  let cursor=null;
  while(true) {
    let query=db.collection('registrations').orderBy('__name__').limit(100);
    if(cursor)query=query.startAfter(cursor);
    const page=await query.get();if(page.empty)break;
    for(const registration of page.docs) {
      inspected++;
      const key=sha256(registration.id),receiptRef=db.doc(`migrationReceipts/${MIGRATION_ID}/items/${key}`);
      const count=await db.runTransaction(async(tx)=>{
        const current=await tx.get(registration.ref),prior=await tx.get(receiptRef);
        if(prior.exists && prior.data().rolledBack!==true)return -1;
        const reg=current.data();
        const refs=[db.doc(`teams/${registration.id}`),...(/^[a-f0-9]{64}$/.test(reg.proofSha256||'')?[db.doc(`proofDigests/${reg.proofSha256}`)]:[])];
        const docs=await Promise.all(refs.map((ref)=>tx.get(ref)));
        const plan=planRegistration(registration.id,reg,docs[0].exists?docs[0].data():null,docs[1]?.exists?docs[1].data():null,Timestamp.now());
        if(!args.apply)return plan.length;
        for(const operation of plan)tx.set(db.doc(operation.path),operation.after);
        tx.set(receiptRef,{migrationId:MIGRATION_ID,registrationId:registration.id,operations:plan,appliedAt:Timestamp.now(),rolledBack:false});
        if(plan.length)tx.set(db.collection('auditLogs').doc(),{action:'migration.applied',actorUid:'operator-tool',actorRole:'operator',targetType:'migration',targetId:MIGRATION_ID,details:{operations:plan.length,receipt:key},createdAt:Timestamp.now()});
        return plan.length;
      });
      if(count<0)skipped++;else changed+=count;
    }
    cursor=page.docs.at(-1);if(page.size<100)break;
  }
}
console.log(JSON.stringify({projectId,mode:args.apply?'apply':'dry-run',operation:rollback?'rollback':'migrate',inspected,operations:changed,alreadyProcessed:skipped,blockedByLaterChanges:guarded}));
