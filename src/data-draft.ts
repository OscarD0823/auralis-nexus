import type {DataBrowse} from './data-core';
/** Recovery is editor metadata. Restoring it never executes SQL or modifies records. */
export type DataDraft={sql:string;newTable:string;definition:string;createOpen:boolean;tab:string;table:string;rowKey?:Record<string,string|number|null>;record?:Record<string,string>;newRecord?:boolean;params?:Record<string,string>;paramTypes?:Record<string,'text'|'number'|'null'>;queryName?:string;queryId?:string;nullFields?:string[];browse?:DataBrowse};
export function recoverDataDraft(value:unknown):DataDraft|undefined{
 if(!value||typeof value!=='object')return;
 const v=value as Record<string,unknown>;
 if(!['sql','newTable','definition','tab','table'].every(k=>typeof v[k]==='string')||typeof v.createOpen!=='boolean')return;
 const record=v.record;
 if(record!==undefined&&(!record||typeof record!=='object'||Array.isArray(record)||!Object.values(record).every(x=>typeof x==='string')))return;
 const key=v.rowKey;
 if(key!==undefined&&(!key||typeof key!=='object'||Array.isArray(key)||!Object.values(key).every(x=>x===null||typeof x==='string'||typeof x==='number'&&Number.isFinite(x))))return;
 const extra:Partial<DataDraft>={};
 if(v.browse&&typeof v.browse==='object'){
  const b=v.browse as Record<string,unknown>;
  extra.browse={offset:typeof b.offset==='number'&&Number.isFinite(b.offset)?Math.max(0,Math.floor(b.offset)):0,pageSize:[25,50,100,250,500].includes(Number(b.pageSize))?Number(b.pageSize):100,search:typeof b.search==='string'?b.search.slice(0,500):'',sort:typeof b.sort==='string'?b.sort:'',direction:b.direction==='desc'?'desc':'asc'};
 }
 if(v.paramTypes&&typeof v.paramTypes==='object'&&!Array.isArray(v.paramTypes)&&Object.values(v.paramTypes).every(x=>['text','number','null'].includes(String(x))))extra.paramTypes=v.paramTypes as DataDraft['paramTypes'];
 if(v.params&&typeof v.params==='object'&&!Array.isArray(v.params)&&Object.values(v.params).every(x=>typeof x==='string'))extra.params=v.params as Record<string,string>;
 if(typeof v.queryName==='string')extra.queryName=v.queryName.slice(0,120);
 if(typeof v.queryId==='string')extra.queryId=v.queryId;
 if(Array.isArray(v.nullFields)&&v.nullFields.every(x=>typeof x==='string'))extra.nullFields=v.nullFields;
 return {sql:v.sql as string,newTable:v.newTable as string,definition:v.definition as string,createOpen:v.createOpen,tab:['Tabla','Constructor','Consulta SQL','Análisis','Salud','Diseño','Relaciones'].includes(v.tab as string)?v.tab as string:'Tabla',table:v.table as string,rowKey:key as DataDraft['rowKey'],record:record as DataDraft['record'],newRecord:v.newRecord===true,...extra};
}
