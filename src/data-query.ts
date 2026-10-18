import {sqlName,type DataSchema,type DataRelation} from './data-core';
export type QueryField={table:string;column:string};
export type QueryJoin={table:string;pairs:{from:string;to:string}[];direction:'out'|'in';id:number};
export function relatedJoins(schema:DataSchema[],table:string):QueryJoin[]{
 const result:QueryJoin[]=[];
 const add=(relations:DataRelation[],source:string,direction:'out'|'in')=>{for(const id of new Set(relations.map(r=>r.id))){
  const group=relations.filter(r=>r.id===id).sort((a,b)=>a.seq-b.seq),target=group[0].table;if(direction==='in'&&target!==table||direction==='out'&&source!==table)continue;
  const parent=schema.find(t=>t.name===target),pk=parent?.columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk)??[],pairs=group.map((r,i)=>({from:r.from,to:r.to??pk[i]?.name??''}));if(pairs.some(p=>!p.to)||source===target)continue;
  result.push({table:direction==='out'?target:source,pairs:direction==='out'?pairs:pairs.map(p=>({from:p.to,to:p.from})),direction,id});
 }};
 for(const t of schema){if(t.name===table)add(t.relations,t.name,'out');else add(t.relations,t.name,'in');}return result;
}
export function buildDataQuery(schema:DataSchema[],table:string,options:{fields:QueryField[];join?:QueryJoin;aggregate?:'COUNT'|'SUM'|'AVG'|'MIN'|'MAX';metric?:QueryField;group?:QueryField;filter?:QueryField;operator?:'contains'|'equals'|'gte'|'lte';value?:string}){
 if(!schema.some(t=>t.name===table))throw Error('Selecciona una tabla.');const join=options.join;
 if(join&&!relatedJoins(schema,table).some(j=>JSON.stringify(j)===JSON.stringify(join)))throw Error('La relación seleccionada ya no existe.');
 const field=(f:QueryField)=>{if(!schema.find(t=>t.name===f.table)?.columns.some(c=>c.name===f.column)||![table,join?.table].includes(f.table))throw Error('Selecciona un campo válido.');return (f.table===table?'t0':'t1')+'.'+sqlName(f.column);};
 let selection:string;
 if(options.aggregate){if(!['COUNT','SUM','AVG','MIN','MAX'].includes(options.aggregate))throw Error('Agregación no admitida.');selection=(options.group?field(options.group)+' AS "Grupo", ':'')+options.aggregate+'('+(options.aggregate==='COUNT'?'*':options.metric?field(options.metric):(()=>{throw Error('Selecciona un campo para el cálculo.');})())+') AS "Resultado"';}
 else{if(!options.fields.length)throw Error('Selecciona al menos un campo.');selection=options.fields.map(f=>field(f)+' AS '+sqlName(join?f.table+'.'+f.column:f.column)).join(', ');}
 let sql='SELECT '+selection+'\nFROM '+sqlName(table)+' AS t0';if(join)sql+='\nLEFT JOIN '+sqlName(join.table)+' AS t1 ON '+join.pairs.map(p=>'t0.'+sqlName(p.from)+' = t1.'+sqlName(p.to)).join(' AND ');
 const params:Record<string,string>={};if(options.filter){const expression=field(options.filter),op=options.operator??'contains';if(!['contains','equals','gte','lte'].includes(op))throw Error('Filtro no admitido.');sql+='\nWHERE '+(op==='contains'?'CAST('+expression+' AS TEXT) LIKE :filtro ESCAPE \'\\\'':expression+({equals:' = ',gte:' >= ',lte:' <= '}[op]??' = ')+':filtro');params[':filtro']=op==='contains'?'%'+(options.value??'').replace(/[\\%_]/g,'\\$&')+'%':options.value??'';}
 if(options.aggregate&&options.group)sql+='\nGROUP BY '+field(options.group)+'\nORDER BY "Resultado" DESC';return {sql:sql+';',params};
}
/** Named parameters outside SQL strings, identifiers and comments. */
export function dataParameters(sql:string){const clean=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g,' ');return [...new Set(clean.match(/[:@$][\p{L}_][\p{L}\p{N}_]*/gu)??[])];}
