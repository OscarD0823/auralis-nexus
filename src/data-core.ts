import type {Database, SqlJsStatic, SqlValue} from 'sql.js';
import type {Worksheet, Cell, Font} from 'exceljs';
export function styleDataWorksheet(sheet:Worksheet,fontFamily:string){
 const cells:{cell:Cell;font:Partial<Font>}[]=[];
 sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>cells.push({cell,font:{...cell.font}})));
 sheet.columns.forEach(column=>{column.font={...column.font,name:fontFamily};});
 cells.forEach(({cell,font})=>{cell.font={...font,name:fontFamily};});
}
export type DataColumn={name:string;type:string;pk:number;notnull:number;dflt_value:SqlValue};
export type DataTable={name:string;type:string;sql:string};
export type DataRelation={id:number;seq:number;table:string;from:string;to:string|null;on_delete:string;on_update:string};
export type DataIndex={name:string;unique:number;origin:string;partial:number;columns:string[]};
export type DataBrowse={offset?:number;pageSize?:number;search?:string;sort?:string;direction?:'asc'|'desc'};
export type SavedDataQuery={id:string;name:string;sql:string;updated:number};
export type DataResult={columns:string[];values:SqlValue[][];truncated:boolean};
export type DataView={tables:DataTable[];table:string;columns:DataColumn[];rows:Record<string,SqlValue>[];keys:Record<string,SqlValue>[];count:number;filteredCount:number;offset:number;pageSize:number;relations:DataRelation[];indexes:DataIndex[];savedQueries:SavedDataQuery[];query?:DataResult[]};
export type DataSchema=DataTable&{columns:DataColumn[];relations:DataRelation[]};
export type DataHealth={integrity:string[];foreignKeys:Record<string,SqlValue>[];foreignKeysTruncated:boolean;schema:DataSchema[];counts:{table:string;count:number}[]};
export type DataAnalysis={table:string;count:number;profiles:{name:string;missing:number;distinct:number;min:SqlValue;max:SqlValue;sum:number|null;average:number|null}[];groups:{label:string;value:number;records:number}[];group:string;metric:string};
export const sqlName=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const library='_auralis_nexus_queries_v1';
export class DataDatabase{
 db:Database;
 constructor(SQL:SqlJsStatic,bytes?:Uint8Array){if(bytes&&bytes.length>80*1024*1024)throw Error('Usa una base de datos de hasta 80 MB.');this.db=new SQL.Database(bytes);this.db.run('PRAGMA foreign_keys=ON');}
 private objects(sql:string,params:Record<string,SqlValue>={}){const statement=this.db.prepare(sql),result:Record<string,SqlValue>[]=[];try{statement.bind(params);while(statement.step())result.push(statement.getAsObject());return result;}finally{statement.free();}}
 columns(table:string){return this.objects('PRAGMA table_info('+sqlName(table)+')') as unknown as DataColumn[];}
 relations(table:string){return this.objects('PRAGMA foreign_key_list('+sqlName(table)+')') as unknown as DataRelation[];}
 private hasLibrary(){if(!this.db.exec('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=\''+library+'\'').length)return false;const cols=this.columns(library);return cols.length===4&&['id','name','sql','updated'].every((name,i)=>cols[i].name===name)&&cols[0].pk===1;}
 tables():DataTable[]{const hidden=this.hasLibrary();return this.objects("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").filter(row=>!hidden||row.name!==library).map(row=>({name:String(row.name),type:String(row.type),sql:String(row.sql??'')}));}
 private requireTable(table:string,write=false){const found=this.tables().find(t=>t.name===table);if(!found||write&&found.type!=='table')throw Error('Selecciona una tabla válida para esta operación.');return this.columns(table);}
 private browseSql(table:string,browse:DataBrowse,selection='*'){
  const columns=this.requireTable(table),search=String(browse.search??'').slice(0,500),params:Record<string,SqlValue>={};let where='';
  if(search){params[':search']='%'+search.replace(/[\\%_]/g,'\\$&')+'%';where=' WHERE ('+columns.map(c=>'CAST('+sqlName(c.name)+' AS TEXT) LIKE :search ESCAPE \'\\\'').join(' OR ')+')';}
  const sorted=columns.find(c=>c.name===browse.sort),order=sorted?' ORDER BY '+sqlName(sorted.name)+(browse.direction==='desc'?' DESC':' ASC'):columns.some(c=>c.pk)?' ORDER BY '+columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>sqlName(c.name)).join(','):'';
  return {sql:'SELECT '+selection+' FROM '+sqlName(table)+where,order,params};
 }
 savedQueries():SavedDataQuery[]{return this.hasLibrary()?this.objects('SELECT * FROM '+sqlName(library)+' ORDER BY name').map(row=>({id:String(row.id),name:String(row.name),sql:String(row.sql),updated:Number(row.updated)})):[];}
 snapshot(table='',browse:DataBrowse={}):DataView{
  const tables=this.tables(),savedQueries=this.savedQueries();table=tables.some(t=>t.name===table)?table:tables[0]?.name??'';
  const pageSize=[25,50,100,250,500].includes(browse.pageSize??100)?browse.pageSize??100:100;
  if(!table)return {tables,table:'',columns:[],rows:[],keys:[],count:0,filteredCount:0,offset:0,pageSize,relations:[],indexes:[],savedQueries};
  const columns=this.columns(table),relations=this.relations(table),base=this.browseSql(table,browse);
  const count=Number(this.db.exec('SELECT COUNT(*) FROM '+sqlName(table))[0]?.values[0]?.[0]??0),filteredCount=browse.search?Number(this.objects(this.browseSql(table,browse,'COUNT(*) AS total').sql,base.params)[0].total):count;
  const requested=Number.isFinite(browse.offset)?Math.max(0,Math.floor(browse.offset!)):0,offset=Math.min(requested,Math.max(0,Math.ceil(filteredCount/pageSize)-1)*pageSize);
  const rowid=tables.find(t=>t.name===table)?.type==='table'?['rowid','_rowid_','oid'].find(key=>!columns.some(c=>c.name.toLowerCase()===key)):undefined;
  const alias='__auralis_key_'+crypto.randomUUID().replaceAll('-',''),suffix=base.order+' LIMIT '+pageSize+' OFFSET '+offset;let hasRowId=!!rowid,rows:Record<string,SqlValue>[];
  try{if(!rowid)throw Error('Sin rowid');rows=this.objects(this.browseSql(table,browse,rowid+' AS '+sqlName(alias)+',*').sql+suffix,base.params);}catch{hasRowId=false;rows=this.objects(base.sql+suffix,base.params);}
  const keys=rows.map(row=>hasRowId?{[rowid!]:row[alias]}:tables.find(t=>t.name===table)?.type==='table'&&columns.some(c=>c.pk)?Object.fromEntries(columns.filter(c=>c.pk).map(c=>[c.name,row[c.name]])):{});if(hasRowId)for(const row of rows)delete row[alias];
  const indexes=this.objects('PRAGMA index_list('+sqlName(table)+')').map(r=>({name:String(r.name),unique:Number(r.unique),origin:String(r.origin),partial:Number(r.partial),columns:this.objects('PRAGMA index_info('+sqlName(String(r.name))+')').map(c=>String(c.name??'(expresión)'))}));
  return {tables,table,columns,relations,indexes,rows,keys,count,filteredCount,offset,pageSize,savedQueries};
 }
 sql(sql:string,params:Record<string,SqlValue>={},readOnly=false,limit=500,verify?:()=>void):DataResult[]{
  if(sql.length>100_000)throw Error('La consulta supera 100.000 caracteres.');const results:DataResult[]=[];let count=0;if(readOnly)this.db.run('PRAGMA query_only=ON');
  try{this.db.run('BEGIN');try{for(const statement of this.db.iterateStatements(sql)){try{
   if(++count>100)throw Error('Ejecuta hasta 100 sentencias por operación.');
   const source=statement.getSQL().replace(/^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/g,'');
   if(/^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH|VACUUM|PRAGMA)\b/i.test(source))throw Error('La operación administra su propia transacción; usa consultas de datos y diseño.');
   statement.bind(params);const values:SqlValue[][]=[];let truncated=false,volume=0;
   // Drain RETURNING statements: stopping at the preview limit can leave a write incomplete.
   while(statement.step()){if(values.length<limit){const value=statement.get();if(limit>500){volume+=64;for(const v of value)volume+=v instanceof Uint8Array?v.byteLength:typeof v==='string'?v.length*2+16:16;if(volume>64*1024*1024)throw Error('El resultado supera 64 MB en memoria. Reduce el filtro o exporta SQLite para conservar todo.');}values.push(value);}else{truncated=true;if(readOnly)break;}}
   results.push({columns:statement.getColumnNames(),values,truncated});
  }finally{statement.free();}}verify?.();this.db.run('COMMIT');return results;}catch(error){this.db.run('ROLLBACK');throw error;}}finally{if(readOnly)this.db.run('PRAGMA query_only=OFF');}
 }
 insert(table:string,row:Record<string,SqlValue>){const columns=this.requireTable(table,true),fields=Object.keys(row);if(fields.some(f=>!columns.some(c=>c.name===f)))throw Error('El registro contiene campos desconocidos.');if(!fields.length)this.db.run('INSERT INTO '+sqlName(table)+' DEFAULT VALUES');else this.db.run('INSERT INTO '+sqlName(table)+'('+fields.map(sqlName).join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')',fields.map(field=>row[field]));}
 private change(table:string,key:Record<string,SqlValue>,row?:Record<string,SqlValue>){
  const columns=this.requireTable(table,true),keys=Object.keys(key),fields=Object.keys(row??{});if(!keys.length)throw Error('Esta vista no tiene una clave para editar registros.');if(fields.some(f=>!columns.some(c=>c.name===f)))throw Error('El registro contiene campos desconocidos.');if(row&&!fields.length)throw Error('No hay campos para actualizar.');
  this.db.run('BEGIN');try{const where=' WHERE '+keys.map(k=>sqlName(k)+' IS ?').join(' AND '),matches=this.db.exec('SELECT COUNT(*) FROM '+sqlName(table)+where,keys.map(k=>key[k]))[0]?.values[0]?.[0];if(matches!==1)throw Error('La clave no identifica un único registro. Actualiza la vista antes de editar.');this.db.run(row?'UPDATE '+sqlName(table)+' SET '+fields.map(f=>sqlName(f)+'=?').join(',')+where:'DELETE FROM '+sqlName(table)+where,[...fields.map(f=>row![f]),...keys.map(k=>key[k])]);this.db.run('COMMIT');}catch(error){this.db.run('ROLLBACK');throw error;}
 }
 update(table:string,key:Record<string,SqlValue>,row:Record<string,SqlValue>){this.change(table,key,row);}
 remove(table:string,key:Record<string,SqlValue>){this.change(table,key);}
 saveQuery(query:SavedDataQuery){
  if(!query.id||!query.name.trim()||query.name.length>120||!query.sql.trim()||query.sql.length>100_000)throw Error('Indica un nombre (hasta 120 caracteres) y una consulta válida.');
  if(!this.hasLibrary()&&this.db.exec('SELECT 1 FROM sqlite_master WHERE name=\''+library+'\'').length)throw Error('El nombre reservado de la biblioteca ya existe con otra estructura. No se modificó.');
  this.db.run('CREATE TABLE IF NOT EXISTS '+sqlName(library)+'(id TEXT PRIMARY KEY,name TEXT NOT NULL,sql TEXT NOT NULL,updated INTEGER NOT NULL)');this.db.run('INSERT INTO '+sqlName(library)+' VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sql=excluded.sql,updated=excluded.updated',[query.id,query.name.trim(),query.sql,query.updated]);
 }
 deleteQuery(id:string){if(this.hasLibrary())this.db.run('DELETE FROM '+sqlName(library)+' WHERE id=?',[id]);}
 importRows(columns:string[],rows:unknown[][]){
  if(!columns.length||columns.length>100||rows.length>10000||columns.some(c=>!c)||new Set(columns).size!==columns.length)throw Error('Importa hasta 10.000 filas y 100 campos con nombres únicos.');
  this.db.run('BEGIN');let statement;
  try{this.db.run('CREATE TABLE "Importada"('+columns.map(c=>sqlName(c)+' TEXT').join(',')+')');statement=this.db.prepare('INSERT INTO "Importada" VALUES('+columns.map(()=>'?').join(',')+')');
   for(const row of rows){if(!Array.isArray(row)||row.length>columns.length)throw Error('Una fila tiene más campos que el encabezado.');statement.run(columns.map((_,i)=>row[i]===null||row[i]===undefined?null:String(row[i])));}
   statement.free();statement=undefined;this.db.run('COMMIT');
  }catch(error){statement?.free();this.db.run('ROLLBACK');throw error;}
 }
 health():DataHealth{
  const integrity=this.db.exec('PRAGMA integrity_check(50)')[0]?.values.map(v=>String(v[0]))??[],statement=this.db.prepare('PRAGMA foreign_key_check'),foreignKeys:Record<string,SqlValue>[]=[];let foreignKeysTruncated=false;
  try{while(statement.step()){if(foreignKeys.length>=500){foreignKeysTruncated=true;break;}foreignKeys.push(statement.getAsObject());}}finally{statement.free();}
  const schema=this.tables().map(t=>({...t,columns:this.columns(t.name),relations:this.relations(t.name)})),counts=schema.filter(t=>t.type==='table').map(t=>({table:t.name,count:Number(this.db.exec('SELECT COUNT(*) FROM '+sqlName(t.name))[0].values[0][0])}));return {integrity,foreignKeys,foreignKeysTruncated,schema,counts};
 }
 analyze(table:string,group='',metric=''):DataAnalysis{
  const columns=this.requireTable(table).slice(0,100),numeric=(name:string)=>columns.some(c=>c.name===name&&/INT|REAL|NUM|DEC|FLOAT|DOUBLE/i.test(c.type));
  const profiles=columns.map(c=>{const q=sqlName(c.name),number=numeric(c.name),blob=/BLOB/i.test(c.type),r=this.objects('SELECT COUNT(*)-COUNT('+q+') AS missing,COUNT(DISTINCT '+q+') AS distincts,'+(blob?'NULL AS minimum,NULL AS maximum':'MIN('+q+') AS minimum,MAX('+q+') AS maximum')+(number?',SUM('+q+') AS total,AVG('+q+') AS average':'')+' FROM '+sqlName(table))[0];return {name:c.name,missing:Number(r.missing),distinct:Number(r.distincts),min:r.minimum,max:r.maximum,sum:number&&r.total!==null?Number(r.total):null,average:number&&r.average!==null?Number(r.average):null};});
  if(group&&!columns.some(c=>c.name===group))throw Error('Selecciona un campo de agrupación válido.');if(metric&&!numeric(metric))throw Error('Selecciona un campo numérico para la suma.');
  const groups=group?this.objects('SELECT '+sqlName(group)+' AS label,COUNT(*) AS records,'+(metric?'SUM('+sqlName(metric)+')':'COUNT(*)')+' AS value FROM '+sqlName(table)+' GROUP BY '+sqlName(group)+' ORDER BY value DESC LIMIT 12').map(r=>({label:r.label===null?'Sin valor':String(r.label),value:Number(r.value??0),records:Number(r.records)})):[];
  return {table,count:Number(this.db.exec('SELECT COUNT(*) FROM '+sqlName(table))[0].values[0][0]),profiles,groups,group,metric};
 }
 exportRows(table:string,browse:DataBrowse={}):DataResult{const base=this.browseSql(table,browse);return this.exportQuery(base.sql+base.order,base.params);}
 exportQuery(sql:string,params:Record<string,SqlValue>={}):DataResult{const results=this.sql(sql,params,true,100_000);if(results.length!==1||!results[0].columns.length)throw Error('La exportación requiere una única consulta de lectura.');if(results[0].truncated)throw Error('El resultado supera 100.000 filas. Reduce el filtro o exporta SQLite para conservar todo.');let size=0;for(const row of results[0].values){size+=64;for(const v of row)size+=v instanceof Uint8Array?v.byteLength:typeof v==='string'?v.length*2+16:16;if(size>64*1024*1024)throw Error('El resultado supera 64 MB en memoria. Reduce el filtro o exporta SQLite para conservar todo.');}return results[0];}
 export(){const bytes=this.db.export();this.db.run('PRAGMA foreign_keys=ON');return bytes;}
 close(){this.db.close();}
}
