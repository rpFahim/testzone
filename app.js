'use strict';

const state = { data: null, view: 'dashboard', reportRows: [], statusRows: [], statusAllRows: [], feeCounter: 0 };
const feeNames = { admission: 'ভর্তি', tuition: 'বেতন', exam: 'পরীক্ষার ফি', coaching: 'কোচিং ফি', other: 'অন্যান্য ফি' };
const roleNames = { admin: 'Admin', accountant: 'Accountant', teacher: 'Teacher' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const money = (value) => `৳ ${Number(value || 0).toLocaleString('bn-BD', { maximumFractionDigits: 2 })}`;
const banglaNumber = (value) => Number(value || 0).toLocaleString('bn-BD');
const dateText = (value) => value ? new Intl.DateTimeFormat('bn-BD', { day:'numeric', month:'short', year:'numeric' }).format(new Date(`${value}T12:00:00`)) : '';

async function api(url, options = {}) {
  const apiUrl = String(window.STUDENTS_FEES_CONFIG?.API_URL || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(apiUrl)) {
    throw new Error('Backend Setup বাকি আছে। README-BANGLA.md অনুযায়ী config.js-এ Apps Script Web App URL বসান।');
  }
  const method = options.method || 'GET';
  const routes = [
    [/^\/api\/status$/, 'status'], [/^\/api\/setup$/, 'setup'], [/^\/api\/login$/, 'login'],
    [/^\/api\/logout$/, 'logout'], [/^\/api\/bootstrap$/, 'bootstrap'],
    [/^\/api\/students$/, method === 'POST' ? 'studentCreate' : 'students'],
    [/^\/api\/students\/(\d+)$/, 'studentUpdate'], [/^\/api\/transactions$/, 'transactionCreate'],
    [/^\/api\/users$/, 'userCreate'], [/^\/api\/users\/(\d+)\/status$/, 'userStatus'],
    [/^\/api\/users\/(\d+)\/password$/, 'userPassword']
  ];
  let action = '', routeMatch = null;
  for (const [pattern, name] of routes) { const match = url.match(pattern); if (match) { action = name; routeMatch = match; break; } }
  if (!action) throw new Error('অজানা API অনুরোধ।');
  let payload = {};
  try { payload = options.body ? JSON.parse(options.body) : {}; } catch { payload = {}; }
  if (routeMatch?.[1]) payload.id = Number(routeMatch[1]);
  let result;
  try {
    result = await appsScriptRequest(apiUrl, { action, token: localStorage.getItem('sf_session') || '', payload });
  } catch (error) {
    throw new Error(error.message || 'Backend-এর সঙ্গে সংযোগ হচ্ছে না। Apps Script Deploy ও config.js URL পরীক্ষা করুন।');
  }
  if (!result?.ok) {
    if (result?.code === 'AUTH_REQUIRED') { localStorage.removeItem('sf_session'); if (!url.includes('/login')) showGate(false); }
    throw new Error(result?.error || 'কাজটি সম্পন্ন হয়নি।');
  }
  if (action === 'login' && result.data?.session_token) {
    localStorage.setItem('sf_session', result.data.session_token);
    delete result.data.session_token;
  }
  if (action === 'logout') localStorage.removeItem('sf_session');
  return result.data;
}

function appsScriptRequest(apiUrl, request) {
  return new Promise((resolve, reject) => {
    const bridgeId = `sf_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    const frame = document.createElement('iframe');
    const form = document.createElement('form');
    const frameName = `students_fees_bridge_${bridgeId.replace(/[^a-zA-Z0-9_]/g, '')}`;
    frame.name = frameName;
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    form.method = 'POST';
    form.action = apiUrl;
    form.target = frameName;
    form.style.display = 'none';

    const requestInput = document.createElement('input');
    requestInput.type = 'hidden'; requestInput.name = 'request'; requestInput.value = JSON.stringify(request);
    const idInput = document.createElement('input');
    idInput.type = 'hidden'; idInput.name = 'bridge_id'; idInput.value = bridgeId;
    form.append(requestInput, idInput);

    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      setTimeout(() => { frame.remove(); form.remove(); }, 0);
    };
    const onMessage = (event) => {
      const hostname = (() => { try { return new URL(event.origin).hostname; } catch { return ''; } })();
      const trustedGoogleOrigin = hostname === 'script.google.com' || hostname.endsWith('.googleusercontent.com');
      if (!trustedGoogleOrigin || event.data?.source !== 'students-fees-apps-script' || event.data?.bridge_id !== bridgeId || settled) return;
      settled = true; cleanup(); resolve(event.data.response);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; cleanup(); reject(new Error('Backend উত্তর দিতে বেশি সময় নিচ্ছে। Apps Script নতুন Version Deploy করে আবার চেষ্টা করুন।'));
    }, 45000);
    window.addEventListener('message', onMessage);
    document.body.append(frame, form);
    form.submit();
  });
}

function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `toast show${error ? ' error-toast' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = 'toast', 2800);
}
function formBody(form) { return Object.fromEntries(new FormData(form).entries()); }

async function init() {
  $('#today-label').textContent = new Intl.DateTimeFormat('bn-BD', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date());
  $('#payment-date').value = new Date().toISOString().slice(0,10);
  try {
    const status = await api('/api/status');
    if (status.setupRequired) showGate(true);
    else {
      try { await loadApp(); } catch { showGate(false); }
    }
  } catch (error) { showGate(false); $('#gate-error').textContent = error.message; }
  bindEvents();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function showGate(setup) {
  $('#gate').classList.remove('hidden'); $('#app').classList.add('hidden');
  $('#setup-form').classList.toggle('hidden', !setup); $('#login-form').classList.toggle('hidden', setup);
  $('#gate-error').textContent = '';
}

async function loadApp() {
  state.data = await api('/api/bootstrap');
  $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
  const canWrite = ['admin','accountant'].includes(state.data.user.role);
  $$('[data-write]').forEach((el) => el.classList.toggle('hidden', !canWrite));
  $$('[data-admin]').forEach((el) => el.classList.toggle('hidden', state.data.user.role !== 'admin'));
  $('#current-user').innerHTML = `<strong>${escapeHtml(state.data.user.name)}</strong><small>${roleNames[state.data.user.role]}</small>`;
  fillSelects(); renderAll(); showView(state.view === 'users' && state.data.user.role !== 'admin' ? 'dashboard' : state.view);
}

function fillSelects() {
  const classOptions = state.data.settings.classes.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  $('#student-class-filter').innerHTML = '<option value="">সব শ্রেণী</option>' + classOptions;
  $('#report-class').innerHTML = '<option value="">সব শ্রেণী</option>' + classOptions;
  $('#status-class').innerHTML = '<option value="">সব শ্রেণী একসঙ্গে</option>' + classOptions;
  $('[name="class_name"]', $('#student-form')).innerHTML = classOptions;
  $('#report-student').innerHTML = '<option value="">সব শিক্ষার্থী</option>' + state.data.students.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} — ${escapeHtml(s.class_name)} — রোল ${escapeHtml(s.roll)}</option>`).join('');
  const list = $('#student-list'); list.innerHTML = '';
  state.studentKeys = new Map();
  for (const student of state.data.students) {
    const key = `${student.name} — ${student.class_name} — রোল ${student.roll}`;
    state.studentKeys.set(key, student.id);
    const option = document.createElement('option'); option.value = key; list.append(option);
  }
  populateStatusContext();
}

function renderAll() {
  const { summary } = state.data;
  $('#stat-students').textContent = banglaNumber(summary.studentCount); $('#stat-today').textContent = money(summary.todayTotal);
  $('#stat-total').textContent = money(summary.total); $('#stat-receipts').textContent = banglaNumber(summary.receiptCount);
  renderRecent(); renderClassBars(); renderStudents(); renderUsers(); applyReport(); applyStatusReport();
}

function table(headers, rows, empty = 'কোনো তথ্য পাওয়া যায়নি') {
  if (!rows.length) return `<div class="empty-note">${empty}</div>`;
  return `<table class="data-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function renderRecent() {
  const rows = state.data.transactions.slice(0,8).map((t) => `<tr><td><strong>${escapeHtml(t.receipt_no)}</strong></td><td>${escapeHtml(t.student_name)}<br><small>${escapeHtml(t.class_name)} • রোল ${escapeHtml(t.roll)}</small></td><td>${dateText(t.payment_date)}</td><td class="amount">${money(t.total_amount)}</td><td><button class="action-btn" data-receipt="${t.id}">রসিদ</button></td></tr>`);
  $('#recent-table').innerHTML = table(['রসিদ','শিক্ষার্থী','তারিখ','পরিমাণ',''], rows);
}

function renderClassBars() {
  const counts = Object.fromEntries(state.data.settings.classes.map((name) => [name, 0]));
  state.data.students.forEach((s) => counts[s.class_name] = (counts[s.class_name] || 0) + 1);
  const max = Math.max(1, ...Object.values(counts));
  $('#class-bars').innerHTML = Object.entries(counts).map(([name,count]) => `<div class="bar-row"><div><strong>${escapeHtml(name)}</strong><span>${banglaNumber(count)} জন</span></div><span class="bar-track"><i style="width:${Math.round(count/max*100)}%"></i></span></div>`).join('');
}

function renderStudents() {
  const query = $('#student-search').value.trim().toLowerCase(), className = $('#student-class-filter').value;
  const canWrite = ['admin','accountant'].includes(state.data.user.role);
  const students = state.data.students.filter((s) => (!className || s.class_name === className) && (!query || `${s.name} ${s.roll} ${s.mobile} ${s.guardian_name}`.toLowerCase().includes(query)));
  const rows = students.map((s) => `<tr><td><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(s.guardian_name)}</small></td><td><span class="badge">${escapeHtml(s.class_name)}</span></td><td>${escapeHtml(s.roll)}</td><td>${escapeHtml(s.mobile)}</td><td>${banglaNumber(s.academic_year)}</td><td>${canWrite ? `<button class="action-btn" data-edit-student="${s.id}">Edit</button>` : ''}<button class="action-btn" data-student-history="${s.id}">ইতিহাস</button><button class="action-btn" data-student-excel="${s.id}">Excel</button></td></tr>`);
  $('#students-table').innerHTML = table(['শিক্ষার্থী / অভিভাবক','শ্রেণী','রোল','মোবাইল','শিক্ষাবর্ষ','কাজ'], rows);
}

function renderUsers() {
  if (state.data.user.role !== 'admin') return;
  const rows = state.data.users.map((u) => `<tr><td><strong>${escapeHtml(u.name)}</strong><br><small>@${escapeHtml(u.username)}</small></td><td><span class="badge">${roleNames[u.role]}</span></td><td>${u.active ? 'সক্রিয়' : 'বন্ধ'}</td><td><button class="action-btn" data-reset-password="${u.id}">Password</button>${u.id === state.data.user.id ? '' : `<button class="action-btn" data-user-status="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? 'বন্ধ করুন' : 'চালু করুন'}</button>`}</td></tr>`);
  $('#users-table').innerHTML = table(['নাম / Username','ভূমিকা','অবস্থা','কাজ'], rows);
}

function showView(name) {
  state.view = name; const titles = { dashboard:'ড্যাশবোর্ড', students:'শিক্ষার্থী', payment:'ফি গ্রহণ', reports:'রিপোর্ট', users:'ব্যবহারকারী নিয়ন্ত্রণ' };
  $$('.view').forEach((v) => v.classList.remove('active')); $(`#view-${name}`).classList.add('active');
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#page-title').textContent = titles[name]; $('.sidebar').classList.remove('open');
}

function openStudent(id = null) {
  const form = $('#student-form'); form.reset(); form.elements.academic_year.value = state.data.settings.academic_year;
  form.elements.class_name.innerHTML = state.data.settings.classes.map((name) => `<option>${escapeHtml(name)}</option>`).join('');
  $('#student-dialog-title').textContent = id ? 'শিক্ষার্থীর তথ্য Edit' : 'নতুন শিক্ষার্থী';
  if (id) {
    const student = state.data.students.find((s) => s.id === id); if (!student) return;
    for (const key of ['id','name','class_name','roll','guardian_name','mobile','academic_year']) form.elements[key].value = student[key];
  }
  $('#student-dialog').showModal();
}

function selectPaymentStudent() {
  const input = $('#payment-student-search');
  let id = state.studentKeys.get(input.value);
  if (!id) {
    const value = input.value.toLowerCase();
    const matches = state.data.students.filter((s) => `${s.name} ${s.roll} ${s.class_name}`.toLowerCase().includes(value));
    if (matches.length === 1) { id = matches[0].id; input.value = [...state.studentKeys.entries()].find(([,sid]) => sid === id)[0]; }
  }
  state.paymentStudentId = id || null;
  const s = state.data.students.find((student) => student.id === id);
  $('#student-preview').innerHTML = s ? `<div class="student-card"><div class="avatar">♟</div><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.class_name)} • রোল ${escapeHtml(s.roll)}</p><div class="student-facts"><div><span>পিতা/মাতা</span><strong>${escapeHtml(s.guardian_name)}</strong></div><div><span>মোবাইল</span><strong>${escapeHtml(s.mobile)}</strong></div><div><span>শিক্ষাবর্ষ</span><strong>${banglaNumber(s.academic_year)}</strong></div></div></div>` : '<div class="empty-state"><span>♟</span><p>তালিকা থেকে সঠিক শিক্ষার্থী নির্বাচন করুন</p></div>';
}

function addFee(type) {
  const id = ++state.feeCounter;
  const isExam = type === 'exam';
  const contextOptions = isExam
    ? state.data.exams.map((e) => `<option value="${escapeHtml(e.name)}">${escapeHtml(e.name)}</option>`).join('') + '<option value="__custom">কাস্টম পরীক্ষার নাম…</option>'
    : state.data.settings.months.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  const custom = isExam ? `<input class="custom-exam hidden" placeholder="পরীক্ষার কাস্টম নাম">` : (type === 'other' ? '<input class="custom-label" placeholder="ফি-এর নাম (ঐচ্ছিক)">' : '');
  const row = document.createElement('div'); row.className='fee-row'; row.dataset.feeId=id; row.dataset.type=type;
  row.innerHTML = `<label>ফি-এর ধরন<input value="${feeNames[type]}" disabled></label><label>${isExam ? 'পরীক্ষার নাম' : 'মাস'}<select class="fee-context">${contextOptions}</select>${custom}</label><label>টাকার পরিমাণ<input class="fee-amount" type="number" min="1" step="0.01" inputmode="decimal" required placeholder="৳ ০"></label><button type="button" class="remove-fee" aria-label="বাদ দিন">×</button>`;
  const empty = $('.empty-note', $('#fee-items')); if (empty) empty.remove(); $('#fee-items').append(row); updatePaymentTotal();
}

function collectFeeItems() {
  return $$('.fee-row', $('#fee-items')).map((row) => {
    const type = row.dataset.type, context = $('.fee-context', row).value;
    return { fee_type:type, month_name:type === 'exam' ? '' : context, exam_name:type === 'exam' ? (context === '__custom' ? $('.custom-exam',row).value.trim() : context) : '', custom_label:$('.custom-label',row)?.value.trim() || '', amount:Number($('.fee-amount',row).value) };
  });
}
function updatePaymentTotal() { $('#payment-total').textContent = money($$('.fee-amount').reduce((sum,input) => sum + Number(input.value || 0),0)); }

function reportFilters() {
  const params = new URLSearchParams();
  const values = { class_name:$('#report-class').value, student_id:$('#report-student').value, date_from:$('#report-from').value, date_to:$('#report-to').value };
  for (const [key,value] of Object.entries(values)) if (value) params.set(key,value);
  return params;
}

async function downloadExcel(params = new URLSearchParams()) {
  if (!window.ExcelJS) return toast('Excel component Load হয়নি। Page Refresh করুন।', true);
  const className = params.get('class_name') || '';
  const studentId = Number(params.get('student_id') || 0);
  const from = params.get('date_from') || '', to = params.get('date_to') || '';
  const rows = state.data.transactions.filter((t) => (!className || t.class_name === className) && (!studentId || t.student_id === studentId) && (!from || t.payment_date >= from) && (!to || t.payment_date <= to));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Students Fees';
  const sheet = workbook.addWorksheet('Fee History', { views: [{ state:'frozen', ySplit:4 }] });
  const settings = state.data.settings;
  sheet.mergeCells('A1:J1'); sheet.getCell('A1').value = settings.institution_name;
  sheet.mergeCells('A2:J2'); sheet.getCell('A2').value = `${settings.institution_address} | মোবাইল: ${settings.institution_mobile}`;
  sheet.mergeCells('A3:J3'); sheet.getCell('A3').value = `শিক্ষাবর্ষ: ${settings.academic_year} | ফি গ্রহণের ইতিহাস`;
  ['A1','A2','A3'].forEach((cell) => { sheet.getCell(cell).alignment={horizontal:'center'}; sheet.getCell(cell).font={bold:true,size:cell==='A1'?16:11}; });
  sheet.addRow(['রসিদ নং','তারিখ','শিক্ষার্থীর নাম','শ্রেণী','রোল','ফি-এর ধরন','মাস/পরীক্ষা','পরিমাণ','গ্রহণকারী','মন্তব্য']);
  for (const transaction of rows) {
    for (const item of transaction.items) sheet.addRow([transaction.receipt_no,transaction.payment_date,transaction.student_name,transaction.class_name,transaction.roll,feeNames[item.fee_type],item.exam_name||item.month_name||item.custom_label||'',Number(item.amount),transaction.received_by_name,transaction.note||'']);
  }
  const header = sheet.getRow(4); header.font={bold:true,color:{argb:'FFFFFFFF'}}; header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF166534'}}; header.alignment={horizontal:'center'};
  sheet.columns = [{width:18},{width:13},{width:25},{width:16},{width:10},{width:18},{width:24},{width:14},{width:20},{width:25}];
  sheet.getColumn(8).numFmt = '#,##0.00';
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  const safeClass = className.replace(/[^\p{L}\p{N}-]/gu,'-');
  link.download = `Students-Fees-${safeClass || (studentId ? 'Student' : 'Report')}-${new Date().toISOString().slice(0,10)}.xlsx`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function applyReport() {
  const className = $('#report-class').value, studentId = Number($('#report-student').value), from = $('#report-from').value, to = $('#report-to').value;
  state.reportRows = state.data.transactions.filter((t) => (!className || t.class_name === className) && (!studentId || t.student_id === studentId) && (!from || t.payment_date >= from) && (!to || t.payment_date <= to));
  const rows = state.reportRows.map((t) => `<tr><td><strong>${escapeHtml(t.receipt_no)}</strong></td><td>${dateText(t.payment_date)}</td><td>${escapeHtml(t.student_name)}<br><small>${escapeHtml(t.class_name)} • রোল ${escapeHtml(t.roll)}</small></td><td>${t.items.map((i) => `<span class="badge">${feeNames[i.fee_type]}${i.exam_name || i.month_name ? ` — ${escapeHtml(i.exam_name || i.month_name)}` : ''}</span>`).join(' ')}</td><td class="amount">${money(t.total_amount)}</td><td><button class="action-btn" data-receipt="${t.id}">রসিদ</button></td></tr>`);
  $('#reports-table').innerHTML = table(['রসিদ','তারিখ','শিক্ষার্থী','ফি','পরিমাণ',''], rows);
  $('#report-count').textContent = `${banglaNumber(state.reportRows.length)}টি রসিদ`;
  $('#report-total').textContent = `মোট: ${money(state.reportRows.reduce((sum,t) => sum + Number(t.total_amount),0))}`;
}

function populateStatusContext() {
  const type = $('#status-fee-type').value;
  const select = $('#status-context');
  const previous = select.value;
  const isExam = type === 'exam';
  $('#status-context-label').textContent = isExam ? 'পরীক্ষার নাম' : 'মাস';
  const values = isExam
    ? [...new Set([...state.data.exams.map((exam) => exam.name), ...state.data.transactions.flatMap((t) => t.items.filter((i) => i.fee_type === 'exam').map((i) => i.exam_name)).filter(Boolean)])]
    : state.data.settings.months;
  select.innerHTML = `<option value="">${isExam ? 'সব পরীক্ষা' : 'সব মাস'}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (values.includes(previous)) select.value = previous;
  else if (values.length) select.value = isExam ? values[0] : values[Math.min(new Date().getMonth(), values.length - 1)];
}

function applyStatusReport() {
  const className = $('#status-class').value;
  const feeType = $('#status-fee-type').value;
  const context = $('#status-context').value;
  const paymentFilter = $('#status-payment').value;
  state.statusAllRows = state.data.students.filter((student) => !className || student.class_name === className).map((student) => {
    const matches = [];
    state.data.transactions.filter((transaction) => transaction.student_id === student.id).forEach((transaction) => {
      transaction.items.forEach((item) => {
        const itemContext = feeType === 'exam' ? item.exam_name : item.month_name;
        if (item.fee_type === feeType && (!context || itemContext === context)) matches.push({ transaction, item });
      });
    });
    const paid = matches.length > 0;
    return {
      ...student, paid,
      amount: roundClient_(matches.reduce((sum, match) => sum + Number(match.item.amount || 0), 0)),
      receipts: [...new Set(matches.map((match) => match.transaction.receipt_no))].join(', '),
      dates: [...new Set(matches.map((match) => match.transaction.payment_date))].sort().map(dateText).join(', '),
      feeType, context
    };
  });
  state.statusRows = state.statusAllRows.filter((row) => paymentFilter === 'all' || (paymentFilter === 'paid' ? row.paid : !row.paid));
  const paidCount = state.statusAllRows.filter((row) => row.paid).length;
  const unpaidCount = state.statusAllRows.length - paidCount;
  const rows = state.statusRows.map((row) => `<tr><td><span class="badge">${escapeHtml(row.class_name)}</span></td><td>${escapeHtml(row.roll)}</td><td><strong>${escapeHtml(row.name)}</strong><br><small>${escapeHtml(row.guardian_name)}</small></td><td>${escapeHtml(row.mobile)}</td><td class="${row.paid ? 'paid-text' : 'unpaid-text'}">${row.paid ? 'Paid' : 'Not Paid'}</td><td class="amount">${row.paid ? money(row.amount) : '—'}</td><td>${escapeHtml(row.receipts || '—')}<br><small>${escapeHtml(row.dates || '')}</small></td></tr>`);
  $('#status-table').innerHTML = table(['শ্রেণী','রোল','শিক্ষার্থী / অভিভাবক','মোবাইল','স্ট্যাটাস','পরিমাণ','রসিদ / তারিখ'], rows, 'এই Filter-এ কোনো শিক্ষার্থী পাওয়া যায়নি');
  $('#status-count').textContent = `মোট ${banglaNumber(state.statusAllRows.length)} জন • দেখানো হচ্ছে ${banglaNumber(state.statusRows.length)} জন`;
  $('#status-paid-summary').textContent = `Paid ${banglaNumber(paidCount)} • Not Paid ${banglaNumber(unpaidCount)}`;
}

function roundClient_(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function statusReportTitle() {
  const className = $('#status-class').value || 'সব শ্রেণী';
  const feeType = $('#status-fee-type').value;
  const context = $('#status-context').value || (feeType === 'exam' ? 'সব পরীক্ষা' : 'সব মাস');
  return `${className} • ${feeNames[feeType]} • ${context}`;
}

async function downloadStatusExcel() {
  if (!window.ExcelJS) return toast('Excel component Load হয়নি। Page Refresh করুন।', true);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Students Fees';
  const sheet = workbook.addWorksheet('Payment Status', { views: [{ state:'frozen', ySplit:5 }] });
  const settings = state.data.settings;
  sheet.mergeCells('A1:L1'); sheet.getCell('A1').value = settings.institution_name;
  sheet.mergeCells('A2:L2'); sheet.getCell('A2').value = `${settings.institution_address} | মোবাইল: ${settings.institution_mobile}`;
  sheet.mergeCells('A3:L3'); sheet.getCell('A3').value = `শিক্ষাবর্ষ: ${settings.academic_year} | ফি পরিশোধ স্ট্যাটাস`;
  sheet.mergeCells('A4:L4'); sheet.getCell('A4').value = statusReportTitle();
  ['A1','A2','A3','A4'].forEach((cell) => { sheet.getCell(cell).alignment={horizontal:'center'}; sheet.getCell(cell).font={bold:true,size:cell==='A1'?16:11}; });
  sheet.addRow(['ক্রম','শ্রেণী','রোল','শিক্ষার্থীর নাম','পিতা/মাতার নাম','মোবাইল','ফি-এর ধরন','মাস/পরীক্ষা','স্ট্যাটাস','পরিমাণ','রসিদ নং','তারিখ']);
  state.statusRows.forEach((row, index) => sheet.addRow([index+1,row.class_name,row.roll,row.name,row.guardian_name,row.mobile,feeNames[row.feeType],row.context || 'সব',row.paid?'Paid':'Not Paid',row.paid?row.amount:'',row.receipts,row.dates]));
  const header = sheet.getRow(5); header.font={bold:true,color:{argb:'FFFFFFFF'}}; header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF166534'}}; header.alignment={horizontal:'center'};
  sheet.columns = [{width:8},{width:16},{width:10},{width:25},{width:25},{width:16},{width:18},{width:24},{width:13},{width:14},{width:22},{width:22}];
  sheet.getColumn(10).numFmt = '#,##0.00';
  state.statusRows.forEach((row, index) => { const cell=sheet.getCell(`I${index+6}`); cell.font={bold:true,color:{argb:row.paid?'FF15805F':'FFB42318'}}; });
  if (!$('#status-class').value) {
    state.data.settings.classes.forEach((className) => {
      const classRows = state.statusRows.filter((row) => row.class_name === className);
      const classSheet = workbook.addWorksheet(String(className).slice(0,31));
      classSheet.mergeCells('A1:L1'); classSheet.getCell('A1').value = `${className} • ${feeNames[$('#status-fee-type').value]} • ${$('#status-context').value || 'সব'}`;
      classSheet.getCell('A1').font={bold:true,size:14,color:{argb:'FF166534'}}; classSheet.getCell('A1').alignment={horizontal:'center'};
      classSheet.addRow(['ক্রম','শ্রেণী','রোল','শিক্ষার্থীর নাম','পিতা/মাতার নাম','মোবাইল','ফি-এর ধরন','মাস/পরীক্ষা','স্ট্যাটাস','পরিমাণ','রসিদ নং','তারিখ']);
      classRows.forEach((row,index)=>classSheet.addRow([index+1,row.class_name,row.roll,row.name,row.guardian_name,row.mobile,feeNames[row.feeType],row.context||'সব',row.paid?'Paid':'Not Paid',row.paid?row.amount:'',row.receipts,row.dates]));
      const classHeader=classSheet.getRow(2); classHeader.font={bold:true,color:{argb:'FFFFFFFF'}}; classHeader.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF166534'}};
      classSheet.columns=[{width:8},{width:16},{width:10},{width:25},{width:25},{width:16},{width:18},{width:24},{width:13},{width:14},{width:22},{width:22}];
      classSheet.getColumn(10).numFmt='#,##0.00';
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a'); link.href=URL.createObjectURL(blob);
  const safeTitle = statusReportTitle().replace(/[^\p{L}\p{N}-]/gu,'-');
  link.download = `Fee-Status-${safeTitle}-${new Date().toISOString().slice(0,10)}.xlsx`;
  document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

function printStatusReport() {
  const rows = state.statusRows.map((row,index) => `<tr><td>${banglaNumber(index+1)}</td><td>${escapeHtml(row.class_name)}</td><td>${escapeHtml(row.roll)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.guardian_name)}</td><td>${escapeHtml(row.mobile)}</td><td class="${row.paid?'paid-text':'unpaid-text'}">${row.paid?'Paid':'Not Paid'}</td><td class="right">${row.paid?money(row.amount):'—'}</td><td>${escapeHtml(row.receipts||'—')}</td></tr>`).join('');
  const paid = state.statusAllRows.filter((row)=>row.paid).length;
  const content = `<h2 class="title">ফি পরিশোধ স্ট্যাটাস</h2><p style="text-align:center;font-size:12px"><strong>${escapeHtml(statusReportTitle())}</strong><br>Paid: ${banglaNumber(paid)} জন • Not Paid: ${banglaNumber(state.statusAllRows.length-paid)} জন</p><table><thead><tr><th>ক্রম</th><th>শ্রেণী</th><th>রোল</th><th>শিক্ষার্থী</th><th>পিতা/মাতা</th><th>মোবাইল</th><th>স্ট্যাটাস</th><th class="right">পরিমাণ</th><th>রসিদ</th></tr></thead><tbody>${rows}</tbody></table><div class="foot"><div></div><div class="sign">অনুমোদিত স্বাক্ষর</div></div>`;
  printShell('ফি পরিশোধ স্ট্যাটাস', content, true, null, true);
}

function printShell(title, content, auto = true, printWindow = null, landscape = false) {
  const win = printWindow || window.open('', '_blank'); if (!win) { toast('Browser-এ Pop-up অনুমতি দিন।', true); return; }
  const s = state.data.settings;
  const logoUrl = new URL('./logo.png', window.location.href).href;
  win.document.open(); win.document.write(`<!doctype html><html lang="bn"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4${landscape?' landscape':''};margin:14mm}*{box-sizing:border-box}body{font-family:"Nirmala UI","Noto Sans Bengali",sans-serif;color:#17231f;margin:0}.head{text-align:center;border-bottom:2px solid #17694f;padding-bottom:10px;margin-bottom:16px}.head img{width:72px;height:72px;object-fit:contain}.head h1{font-size:22px;margin:4px}.head p{font-size:12px;margin:3px}.title{text-align:center;font-size:16px;margin:15px}.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}.facts div{border-bottom:1px dotted #999;padding:5px;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #b9c5c0;padding:8px;text-align:left}th{background:#edf7f3}.right{text-align:right}.total{font-size:16px;font-weight:bold}.paid-text{color:#0f6b4f;font-weight:bold}.unpaid-text{color:#b42318;font-weight:bold}.foot{display:flex;justify-content:space-between;margin-top:50px}.sign{border-top:1px solid #444;padding-top:5px;width:150px;text-align:center;font-size:12px}.note{margin-top:12px;font-size:11px;color:#555}@media print{.no-print{display:none}}</style></head><body><div class="head"><img src="${logoUrl}"><h1>${escapeHtml(s.institution_name)}</h1><p>${escapeHtml(s.institution_address)} | মোবাইল: ${escapeHtml(s.institution_mobile)}</p><p>শিক্ষাবর্ষ: ${banglaNumber(s.academic_year)}</p></div>${content}${auto ? '<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script>' : ''}</body></html>`); win.document.close();
}

function printReceipt(id, printWindow = null) {
  const t = state.data.transactions.find((row) => row.id === id); if (!t) return;
  const itemRows = t.items.map((i,index) => `<tr><td>${banglaNumber(index+1)}</td><td>${feeNames[i.fee_type]}</td><td>${escapeHtml(i.exam_name || i.month_name || i.custom_label || '')}${i.custom_label && (i.exam_name || i.month_name) ? ` — ${escapeHtml(i.custom_label)}` : ''}</td><td class="right">${money(i.amount)}</td></tr>`).join('');
  const content = `<h2 class="title">ফি গ্রহণের রসিদ</h2><div class="facts"><div><strong>রসিদ নং:</strong> ${escapeHtml(t.receipt_no)}</div><div><strong>তারিখ:</strong> ${dateText(t.payment_date)}</div><div><strong>শিক্ষার্থীর নাম:</strong> ${escapeHtml(t.student_name)}</div><div><strong>শ্রেণী ও রোল:</strong> ${escapeHtml(t.class_name)} — ${escapeHtml(t.roll)}</div></div><table><thead><tr><th>ক্রম</th><th>ফি-এর ধরন</th><th>মাস / পরীক্ষা</th><th class="right">পরিমাণ</th></tr></thead><tbody>${itemRows}<tr><td colspan="3" class="right total">সর্বমোট</td><td class="right total">${money(t.total_amount)}</td></tr></tbody></table>${t.note ? `<p class="note"><strong>মন্তব্য:</strong> ${escapeHtml(t.note)}</p>` : ''}<div class="foot"><div><small>গ্রহণকারী: ${escapeHtml(t.received_by_name)}</small></div><div class="sign">অনুমোদিত স্বাক্ষর</div></div>`;
  printShell(`রসিদ ${t.receipt_no}`, content, true, printWindow);
}

function printReport() {
  const rows = state.reportRows.map((t,index) => `<tr><td>${banglaNumber(index+1)}</td><td>${escapeHtml(t.receipt_no)}</td><td>${dateText(t.payment_date)}</td><td>${escapeHtml(t.student_name)}</td><td>${escapeHtml(t.class_name)}</td><td>${escapeHtml(t.roll)}</td><td>${t.items.map((i)=>feeNames[i.fee_type]).join(', ')}</td><td class="right">${money(t.total_amount)}</td></tr>`).join('');
  const total = state.reportRows.reduce((sum,t)=>sum+Number(t.total_amount),0);
  printShell('ফি গ্রহণের রিপোর্ট', `<h2 class="title">ফি গ্রহণের রিপোর্ট</h2><table><thead><tr><th>ক্রম</th><th>রসিদ</th><th>তারিখ</th><th>শিক্ষার্থী</th><th>শ্রেণী</th><th>রোল</th><th>ফি</th><th class="right">পরিমাণ</th></tr></thead><tbody>${rows}<tr><td colspan="7" class="right total">সর্বমোট</td><td class="right total">${money(total)}</td></tr></tbody></table><div class="foot"><div></div><div class="sign">অনুমোদিত স্বাক্ষর</div></div>`);
}

function bindEvents() {
  $('#setup-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const body=formBody(event.currentTarget);
    if (body.password !== body.confirm_password) return $('#gate-error').textContent='দুইটি Password একই নয়।';
    try { await api('/api/setup',{method:'POST',body:JSON.stringify(body)}); toast('Setup সম্পন্ন হয়েছে। এখন Login করুন।'); showGate(false); } catch(error){ $('#gate-error').textContent=error.message; }
  });
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#gate-error').textContent='';
    try { await api('/api/login',{method:'POST',body:JSON.stringify(formBody(event.currentTarget))}); await loadApp(); toast('সফলভাবে Login হয়েছে।'); } catch(error){ $('#gate-error').textContent=error.message; }
  });
  $('#logout').addEventListener('click', async () => { try{await api('/api/logout',{method:'POST'});}catch{} localStorage.removeItem('sf_session'); state.data=null; showGate(false); });
  $('#nav').addEventListener('click',(event)=>{const button=event.target.closest('[data-view]');if(button)showView(button.dataset.view);});
  document.addEventListener('click',(event)=>{const go=event.target.closest('[data-go]');if(go)showView(go.dataset.go);});
  $('#menu').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));
  $('#add-student').addEventListener('click',()=>openStudent());
  $$('[data-close]').forEach((button)=>button.addEventListener('click',()=>$('#student-dialog').close()));
  $('#student-form').addEventListener('submit',async(event)=>{event.preventDefault();const body=formBody(event.currentTarget),id=Number(body.id);delete body.id;try{await api(id?`/api/students/${id}`:'/api/students',{method:id?'PUT':'POST',body:JSON.stringify(body)});$('#student-dialog').close();await loadApp();showView('students');toast(id?'তথ্য Update হয়েছে।':'শিক্ষার্থী যোগ হয়েছে।');}catch(error){toast(error.message,true);}});
  $('#student-search').addEventListener('input',renderStudents); $('#student-class-filter').addEventListener('change',renderStudents);
  $('#students-table').addEventListener('click',(event)=>{
    const edit=event.target.closest('[data-edit-student]');if(edit)return openStudent(Number(edit.dataset.editStudent));
    const history=event.target.closest('[data-student-history]');if(history){$('#report-student').value=history.dataset.studentHistory;applyReport();return showView('reports');}
    const excel=event.target.closest('[data-student-excel]');if(excel)downloadExcel(new URLSearchParams({student_id:excel.dataset.studentExcel}));
  });
  $('#payment-student-search').addEventListener('input',selectPaymentStudent); $('#payment-student-search').addEventListener('change',selectPaymentStudent);
  $('#fee-picker').addEventListener('click',(event)=>{const button=event.target.closest('[data-fee]');if(button)addFee(button.dataset.fee);});
  $('#fee-items').addEventListener('click',(event)=>{const remove=event.target.closest('.remove-fee');if(remove){remove.closest('.fee-row').remove();if(!$('.fee-row',$('#fee-items')))$('#fee-items').innerHTML='<div class="empty-note">উপর থেকে ফি-এর ধরন নির্বাচন করুন</div>';updatePaymentTotal();}});
  $('#fee-items').addEventListener('input',updatePaymentTotal);
  $('#fee-items').addEventListener('change',(event)=>{if(event.target.classList.contains('fee-context')){const custom=$('.custom-exam',event.target.closest('.fee-row'));if(custom){custom.classList.toggle('hidden',event.target.value!=='__custom');if(event.target.value==='__custom')custom.focus();}}});
  $('#payment-form').addEventListener('submit',async(event)=>{event.preventDefault();selectPaymentStudent();const items=collectFeeItems();if(!state.paymentStudentId)return toast('তালিকা থেকে শিক্ষার্থী নির্বাচন করুন।',true);if(!items.length)return toast('অন্তত একটি ফি নির্বাচন করুন।',true);const printWindow=window.open('','_blank');try{const result=await api('/api/transactions',{method:'POST',body:JSON.stringify({student_id:state.paymentStudentId,payment_date:$('#payment-date').value,note:$('#payment-note').value,items})});await loadApp();const transaction=state.data.transactions.find((t)=>t.id===result.id);$('#payment-form').reset();$('#payment-date').value=new Date().toISOString().slice(0,10);$('#fee-items').innerHTML='<div class="empty-note">উপর থেকে ফি-এর ধরন নির্বাচন করুন</div>';state.paymentStudentId=null;$('#student-preview').innerHTML='<div class="empty-state"><span>♟</span><p>শিক্ষার্থী নির্বাচন করলে এখানে তথ্য দেখা যাবে</p></div>';updatePaymentTotal();showView('payment');toast(`রসিদ ${result.receipt_no} তৈরি হয়েছে।`);if(transaction)printReceipt(transaction.id,printWindow);}catch(error){if(printWindow)printWindow.close();toast(error.message,true);}});
  $('#report-apply').addEventListener('click',applyReport); $('#report-class').addEventListener('change',()=>{$('#report-student').value='';const value=$('#report-class').value;$$('option',$('#report-student')).forEach((o)=>{if(!o.value)return;o.hidden=!!value&&state.data.students.find((s)=>s.id===Number(o.value))?.class_name!==value;});});
  $('#report-print').addEventListener('click',printReport); $('#report-excel').addEventListener('click',()=>downloadExcel(reportFilters()));
  $('#status-fee-type').addEventListener('change',()=>{populateStatusContext();applyStatusReport();});
  $('#status-class').addEventListener('change',applyStatusReport); $('#status-context').addEventListener('change',applyStatusReport); $('#status-payment').addEventListener('change',applyStatusReport);
  $('#status-apply').addEventListener('click',applyStatusReport); $('#status-print').addEventListener('click',printStatusReport); $('#status-excel').addEventListener('click',downloadStatusExcel);
  document.addEventListener('click',(event)=>{const receipt=event.target.closest('[data-receipt]');if(receipt)printReceipt(Number(receipt.dataset.receipt));});
  $('#user-form').addEventListener('submit',async(event)=>{event.preventDefault();try{await api('/api/users',{method:'POST',body:JSON.stringify(formBody(event.currentTarget))});event.currentTarget.reset();await loadApp();showView('users');toast('ব্যবহারকারী তৈরি হয়েছে।');}catch(error){toast(error.message,true);}});
  $('#users-table').addEventListener('click',async(event)=>{const reset=event.target.closest('[data-reset-password]');if(reset){const password=prompt('নতুন Password লিখুন (কমপক্ষে ৬ অক্ষর):');if(password===null)return;try{await api(`/api/users/${reset.dataset.resetPassword}/password`,{method:'PATCH',body:JSON.stringify({password})});return toast('Password পরিবর্তন হয়েছে।');}catch(error){return toast(error.message,true);}}const button=event.target.closest('[data-user-status]');if(!button)return;try{await api(`/api/users/${button.dataset.userStatus}/status`,{method:'PATCH',body:JSON.stringify({active:Number(button.dataset.active)})});await loadApp();showView('users');toast('Account-এর অবস্থা পরিবর্তন হয়েছে।');}catch(error){toast(error.message,true);}});
}

init();
