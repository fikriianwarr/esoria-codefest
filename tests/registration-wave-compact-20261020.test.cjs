'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const src = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
const html = src('public/form-pendaftaran.html');
const js = src('public/registration.js');

test('wave trigger keeps complete official labels with compact visible variants', () => {
  assert.match(html, /data-label="Wave Awal Bulan — mulai tanggal 1" data-compact-label="Wave Awal · Tgl 1" data-value="wave-01"/);
  assert.match(html, /data-label="Wave Pertengahan Bulan — mulai tanggal 15" data-compact-label="Wave Tengah · Tgl 15" data-value="wave-02"/);
  assert.match(src('public/spark-data.js'), /Wave Awal Bulan — mulai tanggal 1/);
  assert.match(src('functions/index.js'), /Wave Pertengahan Bulan — mulai tanggal 15/);
  assert.match(src('public/registration-paper-compact.css'), /#wave-selected\s*\{[^}]*white-space:nowrap;/);
});

test('selecting and restoring a wave uses a single-line visible label but stable API ID', () => {
  const start = js.indexOf('const selectCustomOption = (component, option, emit = true) => {');
  const end = js.indexOf('\ncustomSelects.forEach(', start);
  assert.ok(start > -1 && end > start);
  const snippet = js.slice(start, end);
  const selected = {textContent:'',title:'',removeAttribute(attr){if(attr === 'title')this.title = '';}};
  const input = {value:'',closest:() => component,dispatchEvent:() => dispatched++};
  const trigger = {classList:{toggle:(_,v)=>{placeholder=v;}}};
  const optionA = {disabled:false,dataset:{value:'wave-01',label:'Wave Awal Bulan — mulai tanggal 1',compactLabel:'Wave Awal · Tgl 1'},attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
  const optionB = {disabled:false,dataset:{value:'wave-02',label:'Wave Pertengahan Bulan — mulai tanggal 15',compactLabel:'Wave Tengah · Tgl 15'},attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
  const options = [optionA,optionB];
  const component = {classList:{remove(){}},querySelector(selector){if(selector==='[data-custom-input]')return input;if(selector==='.custom-select-trigger')return trigger;if(selector==='[data-selected-label]')return selected;return null;},querySelectorAll(){return options;}};
  let dispatched=0, placeholder=null;
  const fn=vm.runInNewContext(`${snippet}\n({selectCustomOption,setCustomValue})`,{Event:class{}});
  fn.selectCustomOption(component,optionA);
  assert.equal(input.value,'wave-01');
  assert.equal(selected.textContent,'Wave Awal · Tgl 1');
  assert.equal(selected.title,'Wave Awal Bulan — mulai tanggal 1');
  assert.equal(placeholder,false);
  assert.equal(dispatched,1);
  assert.equal(optionA.attrs['aria-selected'],'true');
  fn.setCustomValue(input,'wave-02');
  assert.equal(input.value,'wave-02');
  assert.equal(selected.textContent,'Wave Tengah · Tgl 15');
  assert.equal(selected.title,'Wave Pertengahan Bulan — mulai tanggal 15');
  assert.equal(dispatched,1,'restoring form state should not emit duplicate change');
  assert.equal(optionB.attrs['aria-selected'],'true');
});

test('disabled wave cannot be selected by click or state hydration', () => {
  const start = js.indexOf('const selectCustomOption = (component, option, emit = true) => {');
  const end = js.indexOf('\ncustomSelects.forEach(', start);
  const snippet = js.slice(start,end);
  const input = {value:'',closest:() => component,dispatchEvent:()=>{throw Error('disabled wave event');}};
  const trigger={classList:{toggle:()=>{}}};
  const label={textContent:'Pilih gelombang',removeAttribute:()=>{}};
  const option={disabled:true,dataset:{value:'wave-01',compactLabel:'Wave Awal · Tgl 1'},setAttribute:()=>{}};
  const component = {classList:{remove:()=>{}},querySelector(s){return {'[data-custom-input]':input,'.custom-select-trigger':trigger,'[data-selected-label]':label}[s]},querySelectorAll(){return [option]}};
  const fn=vm.runInNewContext(`${snippet}\n({selectCustomOption,setCustomValue})`,{Event:class{}});
  fn.selectCustomOption(component,option);
  fn.setCustomValue(input,'wave-01');
  assert.equal(input.value,'');
  assert.equal(label.textContent,'Pilih gelombang');
});
