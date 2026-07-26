
const KEY='budgetAppDataV1';
const today=()=>new Date().toISOString().slice(0,10);
const defaultData={settings:{weekStart:today(),budgets:{Groceries:100,Activity:60,Gas:70,Other:20}},expenses:[],debts:[]};
let data=JSON.parse(localStorage.getItem(KEY)||'null')||defaultData;
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(Number(n)||0);
const save=()=>{localStorage.setItem(KEY,JSON.stringify(data));render();};

function weekEnd(start){
  const d=new Date(start+'T12:00:00'); d.setDate(d.getDate()+6); return d.toISOString().slice(0,10);
}
function inWeek(date){
  return date>=data.settings.weekStart && date<=weekEnd(data.settings.weekStart);
}
function render(){
  $('weekStart').value=data.settings.weekStart;
  for(const c of ['Groceries','Activity','Gas','Other']) $('budget'+c).value=data.settings.budgets[c]||0;
  $('expenseDate').value ||= today(); $('debtDate').value ||= today();

  const spent={Groceries:0,Activity:0,Gas:0,Other:0};
  data.expenses.filter(x=>inWeek(x.date)).forEach(x=>spent[x.category]+=Number(x.amount));
  let html='';
  for(const c of Object.keys(spent)){
    const b=Number(data.settings.budgets[c]||0), s=spent[c], rem=b-s;
    html+=`<div class="metric"><span>${c}</span><strong class="${rem<0?'over':'ok'}">${money(rem)} left</strong><small>${money(s)} of ${money(b)}</small></div>`;
  }
  const totalBudget=Object.values(data.settings.budgets).reduce((a,b)=>a+Number(b),0);
  const totalSpent=Object.values(spent).reduce((a,b)=>a+b,0);
  html+=`<div class="metric"><span>Total spent</span><strong>${money(totalSpent)}</strong><small>${money(totalBudget-totalSpent)} remaining</small></div>`;
  $('summary').innerHTML=html;

  $('expenseList').innerHTML=data.expenses.slice().sort((a,b)=>b.date.localeCompare(a.date)).map((x,i)=>
    `<div class="row"><div><b>${x.description}</b><small>${x.date} · ${x.category}</small></div><div><span class="amount">${money(x.amount)}</span><button onclick="deleteExpense('${x.id}')" style="margin-top:6px;padding:5px 8px">Delete</button></div></div>`
  ).join('')||'<p>No expenses yet.</p>';

  const debtTotal=data.debts.reduce((a,b)=>a+Number(b.amount),0);
  $('debtTotal').textContent=money(debtTotal);
  $('debtList').innerHTML=data.debts.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(x=>
    `<div class="row"><div><b>${x.account}</b><small>${x.date}${x.description?' · '+x.description:''}</small></div><div><span class="amount">${money(x.amount)}</span><button onclick="deleteDebt('${x.id}')" style="margin-top:6px;padding:5px 8px">Delete</button></div></div>`
  ).join('')||'<p>No debt payments yet.</p>';
}
$('saveSettings').onclick=()=>{
  data.settings.weekStart=$('weekStart').value;
  for(const c of ['Groceries','Activity','Gas','Other']) data.settings.budgets[c]=Number($('budget'+c).value)||0;
  save();
};
$('expenseForm').onsubmit=e=>{
  e.preventDefault();
  data.expenses.push({id:crypto.randomUUID(),date:$('expenseDate').value,category:$('expenseCategory').value,description:$('expenseDescription').value.trim(),amount:Number($('expenseAmount').value)});
  $('expenseDescription').value=''; $('expenseAmount').value=''; save();
};
$('debtForm').onsubmit=e=>{
  e.preventDefault();
  data.debts.push({id:crypto.randomUUID(),date:$('debtDate').value,account:$('debtAccount').value,description:$('debtDescription').value.trim(),amount:Number($('debtAmount').value)});
  $('debtDescription').value=''; $('debtAmount').value=''; save();
};
window.deleteExpense=id=>{data.expenses=data.expenses.filter(x=>x.id!==id);save();};
window.deleteDebt=id=>{data.debts=data.debts.filter(x=>x.id!==id);save();};
$('clearData').onclick=()=>{if(confirm('Delete all saved budget data?')){data=structuredClone(defaultData);save();}};
$('exportCsv').onclick=()=>{
  const rows=[['Type','Date','Category/Account','Description','Amount']];
  data.expenses.forEach(x=>rows.push(['Expense',x.date,x.category,x.description,x.amount]));
  data.debts.forEach(x=>rows.push(['Debt Payment',x.date,x.account,x.description,x.amount]));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='budget-data.csv';a.click();
};
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
render();
