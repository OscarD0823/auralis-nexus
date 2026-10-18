import initSqlJs from 'sql.js';import {DataDatabase} from './data-core';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm?url';
let database:DataDatabase|undefined;const ready=initSqlJs({locateFile:()=>sqlWasm});
self.onmessage=async event=>{
 const {request,action,bytes,table,sql,row,key,browse,params,readOnly,query,id,group,metric,imported}=event.data;
 try{const SQL=await ready;
  if(action==='open'||action==='import'){const next=new DataDatabase(SQL,bytes);try{if(action==='import')next.importRows(imported.columns,imported.rows);next.snapshot(table,browse);}catch(error){next.close();throw error;}database?.close();database=next;}
  if(!database)throw Error('Abre una base de datos.');let result,results;
  if(action==='sql')results=database.sql(sql,params,readOnly,500,readOnly?undefined:()=>database!.snapshot(table,browse));
  if(action==='insert')database.insert(table,row);if(action==='update')database.update(table,key,row);if(action==='remove')database.remove(table,key);
  if(action==='save-query')database.saveQuery(query);if(action==='delete-query')database.deleteQuery(id);
  if(action==='health')result=database.health();if(action==='analysis')result=database.analyze(table,group,metric);
  if(action==='export-rows')result=database.exportRows(table,browse);if(action==='export-query')result=database.exportQuery(sql,params);
  const changed=action==='open'||action==='import'||['insert','update','remove','save-query','delete-query'].includes(action)||action==='sql'&&!readOnly,snapshot=database.snapshot(table,browse),output=changed?database.export():undefined;
  self.postMessage({request,view:{...snapshot,query:results},bytes:output,result},output?[output.buffer]:[]);
 }catch(error){self.postMessage({request,error:error instanceof Error?error.message:String(error)});}
};
