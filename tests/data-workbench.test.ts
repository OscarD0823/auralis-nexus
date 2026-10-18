import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import {DataDatabase} from '../src/data-core';
import {buildDataQuery,relatedJoins,dataParameters} from '../src/data-query';

const SQL=await initSqlJs();
function fixture(){const db=new DataDatabase(SQL);db.sql("CREATE TABLE Categorias(id INTEGER PRIMARY KEY,nombre TEXT NOT NULL);CREATE TABLE Productos(id INTEGER PRIMARY KEY,nombre TEXT,categoria_id INTEGER REFERENCES Categorias(id),precio REAL,unidades INTEGER DEFAULT 5);INSERT INTO Categorias VALUES(1,'Libros'),(2,'Arte');INSERT INTO Productos VALUES(1,'Atlas',1,12.5,2),(2,'Luz',1,20,3),(3,'Pincel',2,5,4),(4,'Sin categoría',NULL,NULL,0);");return db;}

test('Browse reaches every row, clamps removed last pages, and filters the entire table',()=>{
 const db=fixture();try{db.sql("WITH RECURSIVE n(x) AS (SELECT 5 UNION ALL SELECT x+1 FROM n WHERE x<1507) INSERT INTO Productos(id,nombre) SELECT x,'Producto '||x FROM n;");
  const a=db.snapshot('Productos',{offset:1400,pageSize:100});assert.equal(a.rows.length,100);assert.equal(a.rows[0].id,1401);assert.equal(a.count,1507);
  const b=db.snapshot('Productos',{offset:9000,pageSize:100});assert.equal(b.offset,1500);assert.equal(b.rows.length,7);
  const found=db.snapshot('Productos',{search:'Producto 1507'});assert.equal(found.filteredCount,1);assert.equal(found.rows[0].id,1507);
  assert.equal(db.snapshot('Productos',{sort:'precio',direction:'desc'}).rows[0].nombre,'Luz');
 }finally{db.close();}
});
test('Browse escapes literal percent, underscore, backslash and apostrophes',()=>{
 const db=fixture();try{for(const [id,nombre]of [[8,'100% real'],[9,'un_guion'],[10,"O'Brien"],[11,'C:\\datos']] as const)db.insert('Productos',{id,nombre});
  for(const needle of ['%','_',"O'Brien",'\\'])assert.equal(db.snapshot('Productos',{search:needle}).filteredCount,1);
  assert.equal(db.snapshot('Productos',{search:"' OR 1=1 --"}).filteredCount,0);
 }finally{db.close();}
});
test('Saved queries survive SQLite download/reopen without executing their SQL',()=>{
 const db=fixture();try{db.saveQuery({id:'test',name:'Por categoría',sql:'DELETE FROM Productos;',updated:1});assert.equal(db.snapshot().tables.length,2);assert.equal(db.snapshot('Productos').count,4);
  const copy=new DataDatabase(SQL,db.export());try{assert.equal(copy.savedQueries()[0].sql,'DELETE FROM Productos;');copy.saveQuery({id:'test',name:'Actualizada',sql:'SELECT :nombre;',updated:2});assert.equal(copy.savedQueries().length,1);copy.deleteQuery('test');assert.equal(copy.savedQueries().length,0);assert.equal(copy.snapshot('Productos').count,4);}finally{copy.close();}
 }finally{db.close();}
});
test('A reserved-name collision never overwrites an existing user table',()=>{
 const db=new DataDatabase(SQL);try{db.sql('CREATE TABLE _auralis_nexus_queries_v1(original TEXT);');assert.throws(()=>db.saveQuery({id:'a',name:'X',sql:'SELECT 1',updated:1}),/reservado/);assert.equal(db.tables()[0].name,'_auralis_nexus_queries_v1');}finally{db.close();}
});
test('Read-only mode prevents direct and CTE writes then restores normal editing',()=>{
 const db=fixture();try{assert.throws(()=>db.sql('DELETE FROM Productos',{},true),/readonly|read.only/i);assert.throws(()=>db.sql('WITH x AS (SELECT 1) DELETE FROM Productos;',{},true),/readonly|read.only/i);assert.equal(db.snapshot('Productos').count,4);db.insert('Productos',{id:5,nombre:'Normal'});assert.equal(db.snapshot('Productos').count,5);}finally{db.close();}
});
test('Empty statements and comments cannot bypass transaction and read-only controls',()=>{
 const db=fixture();try{for(const sql of ['; PRAGMA query_only=OFF;DELETE FROM Productos;','/*a*/ ; -- b\nCOMMIT;',';ATTACH DATABASE \'extra.sqlite\' AS extra;'])assert.throws(()=>db.sql(sql,{},true),/transacción/);assert.equal(db.snapshot('Productos').count,4);db.insert('Productos',{id:5,nombre:'Después'});assert.equal(db.snapshot('Productos').count,5);}finally{db.close();}
});
test('Bindings remain data and a failed write batch rolls back all preceding writes',()=>{
 const db=fixture();try{assert.equal(db.sql('SELECT * FROM Productos WHERE nombre=:nombre',{':nombre':"' OR 1=1 --"},true)[0].values.length,0);assert.throws(()=>db.sql('INSERT INTO Categorias VALUES(3,\'Temporal\');INSERT INTO Productos(id,categoria_id) VALUES(5,99);'),/FOREIGN KEY/);assert.equal(db.snapshot('Categorias').count,2);}finally{db.close();}
});
test('A large RETURNING write completes beyond the 500-row preview',()=>{
 const db=new DataDatabase(SQL);try{db.sql('CREATE TABLE numeros(id INTEGER PRIMARY KEY,valor INTEGER);WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1200) INSERT INTO numeros SELECT x,0 FROM n;');const result=db.sql('UPDATE numeros SET valor=valor+1 RETURNING id;')[0];assert.equal(result.values.length,500);assert.equal(result.truncated,true);assert.equal(db.sql('SELECT SUM(valor) FROM numeros')[0].values[0][0],1200);}finally{db.close();}
});
test('Editing nullable duplicate primary keys uses a unique row identity and ambiguous keys fail',()=>{
 const db=new DataDatabase(SQL);try{db.sql('CREATE TABLE contactos(codigo TEXT PRIMARY KEY,nombre TEXT);INSERT INTO contactos VALUES(NULL,\'A\'),(NULL,\'B\');');const view=db.snapshot('contactos');db.update('contactos',view.keys[1],{nombre:'Solo B'});assert.deepEqual(db.snapshot('contactos').rows.map(r=>r.nombre),['A','Solo B']);assert.throws(()=>db.remove('contactos',{codigo:null}),/único/);assert.equal(db.snapshot().count,2);assert.throws(()=>db.update('contactos',{rowid:999},{nombre:'Ausente'}),/único/);}finally{db.close();}
});
test('Views cannot be edited; a compound WITHOUT ROWID key remains editable',()=>{
 const db=new DataDatabase(SQL);try{db.sql('CREATE TABLE partes(a TEXT,b INTEGER,valor TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID;INSERT INTO partes VALUES(\'x\',1,\'Inicial\');CREATE VIEW vista AS SELECT * FROM partes;');assert.deepEqual(db.snapshot('partes').keys[0],{a:'x',b:1});db.update('partes',db.snapshot('partes').keys[0],{valor:'Final'});assert.equal(db.snapshot('vista').rows[0].valor,'Final');assert.deepEqual(db.snapshot('vista').keys,[{}]);assert.throws(()=>db.insert('vista',{a:'y'}),/tabla válida/);}finally{db.close();}
});
test('Full table and query exports exceed the preview but never silently truncate',()=>{
 const db=new DataDatabase(SQL);try{db.sql('CREATE TABLE n(id INTEGER PRIMARY KEY);WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<1507) INSERT INTO n SELECT n FROM x;');assert.equal(db.snapshot('n').rows.length,100);assert.equal(db.exportRows('n').values.length,1507);assert.equal(db.exportRows('n',{search:'1507'}).values.length,1);assert.equal(db.exportQuery('SELECT * FROM n WHERE id>:min',{':min':1500}).values.length,7);assert.throws(()=>db.exportQuery('SELECT 1;SELECT 2;'),/única/);assert.throws(()=>db.exportQuery('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100001) SELECT x FROM n;'),/100.000/);}finally{db.close();}
});
test('Health checks include foreign key violations not reported by integrity_check',()=>{
 const db=fixture();try{db.db.run('PRAGMA foreign_keys=OFF');db.insert('Productos',{id:8,categoria_id:99});db.db.run('PRAGMA foreign_keys=ON');const report=db.health();assert.deepEqual(report.integrity,['ok']);assert.equal(report.foreignKeys.length,1);assert.equal(report.foreignKeys[0].table,'Productos');assert.equal(report.counts.find(t=>t.table==='Productos')?.count,5);assert.equal(report.schema.length,2);}finally{db.close();}
});
test('Analysis profiles the whole table, includes missing values, and aggregates chart groups',()=>{
 const db=fixture();try{const report=db.analyze('Productos','categoria_id','precio');assert.equal(report.count,4);const price=report.profiles.find(p=>p.name==='precio')!;assert.equal(price.missing,1);assert.equal(price.sum,37.5);assert.equal(price.average,12.5);assert.equal(report.groups.find(g=>g.label==='1')?.value,32.5);assert.throws(()=>db.analyze('Productos','inexistente'),/agrupación/);assert.throws(()=>db.analyze('Productos','nombre','nombre'),/numérico/);}finally{db.close();}
});
test('Visual designer joins outgoing and incoming relationships with bound filters',()=>{
 const db=fixture();try{const schema=db.health().schema,joins=relatedJoins(schema,'Productos');assert.equal(joins[0].table,'Categorias');const built=buildDataQuery(schema,'Productos',{fields:[{table:'Productos',column:'nombre'},{table:'Categorias',column:'nombre'}],join:joins[0],filter:{table:'Categorias',column:'nombre'},operator:'equals',value:'Libros'});const result=db.sql(built.sql,built.params,true)[0];assert.deepEqual(result.columns,['Productos.nombre','Categorias.nombre']);assert.equal(result.values.length,2);assert.equal(result.values[0][1],'Libros');const incoming=relatedJoins(schema,'Categorias')[0];assert.equal(incoming.table,'Productos');assert.equal(incoming.direction,'in');
  const grouped=buildDataQuery(schema,'Productos',{fields:[],join:joins[0],aggregate:'SUM',metric:{table:'Productos',column:'precio'},group:{table:'Categorias',column:'nombre'}});assert.deepEqual(db.sql(grouped.sql,{},true)[0].values[0],['Libros',32.5]);
 }finally{db.close();}
});
test('Designer handles composite and implicit primary-key references and validates identifiers',()=>{
 const db=new DataDatabase(SQL);try{db.sql('CREATE TABLE padre(a TEXT,b INTEGER,PRIMARY KEY(a,b));CREATE TABLE hijo(a TEXT,b INTEGER,FOREIGN KEY(a,b) REFERENCES padre);');const schema=db.health().schema,join=relatedJoins(schema,'hijo')[0];assert.deepEqual(join.pairs,[{from:'a',to:'a'},{from:'b',to:'b'}]);const sql=buildDataQuery(schema,'hijo',{join,fields:[{table:'padre',column:'a'}]}).sql;assert.match(sql,/t0\."a" = t1\."a" AND t0\."b" = t1\."b"/);assert.throws(()=>buildDataQuery(schema,'hijo',{fields:[{table:'sqlite_master',column:'sql'}]}),/válido/);assert.throws(()=>buildDataQuery(schema,'hijo',{fields:[]}),/al menos/);}finally{db.close();}
});
test('Parameter discovery ignores quoted content, comments and repeated names',()=>{
 assert.deepEqual(dataParameters("SELECT :mínimo, :mínimo, @nombre, $fin, ':no', \"@col\", [:no], `@no` -- :comentario\n/* $oculto */"),[':mínimo','@nombre','$fin']);
});
test('Export preserves BLOB bytes, indexes, cascading relations and empty text',()=>{
 const db=fixture();try{db.sql('CREATE INDEX precio_idx ON Productos(precio);CREATE TABLE adjuntos(id INTEGER PRIMARY KEY,datos BLOB,nota TEXT);');db.insert('adjuntos',{id:1,datos:new Uint8Array([0,255,4]),nota:''});const copy=new DataDatabase(SQL,db.export());try{assert.deepEqual(copy.snapshot('adjuntos').rows[0].datos,new Uint8Array([0,255,4]));assert.equal(copy.snapshot('adjuntos').rows[0].nota,'');assert.equal(copy.snapshot('Productos').indexes[0].name,'precio_idx');assert.throws(()=>copy.remove('Categorias',{id:1}),/FOREIGN KEY/);}finally{copy.close();}}finally{db.close();}
});
test('Delimited import is atomic and accepts long values without constructing SQL literals',()=>{
 const db=new DataDatabase(SQL);try{assert.throws(()=>db.importRows(['nombre'],[['Ana'],['Demasiados','campos']]),/más campos/);assert.equal(db.tables().length,0);const text="O'Brien "+'x'.repeat(100_001);db.importRows(['nombre','nota'],[['Ana',text],['B',null]]);assert.equal(db.snapshot().count,2);assert.equal(db.snapshot().rows[0].nota,text);}finally{db.close();}
});
test('A failure preparing the updated view rolls back schema and data changes',()=>{
 const db=fixture();try{assert.throws(()=>db.sql('DELETE FROM Productos;',{},false,500,()=>{throw Error('No se puede presentar el resultado');}),/presentar/);assert.equal(db.snapshot('Productos').count,4);assert.equal(db.db.exec('PRAGMA foreign_keys')[0].values[0][0],1);}finally{db.close();}
});
