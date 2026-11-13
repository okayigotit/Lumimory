/** Minimal Lumiverse drawer UI for Prototype C. Local retrieval and opt-in live RP injection. */
export function setup(ctx) {
  const tab = ctx.ui.registerDrawerTab({
    id: 'memory-proto-a', title: '통합 기억 실험실', shortName: '기억',
    description: '상세 기억·원문 독립 검색·태깅·출처 진단·선택적 RP 주입', keywords: ['memory', '기억', '요약', '태깅', '검색'],
    headerTitle: '기억 실험실',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5c3-2 6-2 8 0 2-2 5-2 8 0v15c-3-2-6-2-8 0-2-2-5-2-8 0z"/><path d="M12 5v15"/></svg>',
  });
  const root = tab.root;
  const style = document.createElement('style');
  style.textContent = `
    .impa { padding: 12px; color: var(--lumiverse-text,#ddd); font: inherit; line-height: 1.5; }
    .impa * { box-sizing:border-box; }
    .impa h3 { font-size: 1rem; margin: 10px 0; }
    .impa .info { opacity: .78; font-size: .85rem; margin: 6px 0 12px; }
    .impa .bar { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0; }
    .impa button, .impa select, .impa input, .impa textarea { color:inherit; background:transparent; border:1px solid currentColor; border-radius:8px; font:inherit; padding:7px 9px; max-width:100%; }
    .impa button { cursor: pointer; } .impa button:disabled { opacity:.4; cursor:default; }
    .impa textarea { width:100%; min-height: 115px; resize:vertical; }
    .impa input { width:100%; }
    .impa select { width:100%; margin: 4px 0 8px; }
    .impa label { display:block; font-size:.83rem; margin-top:7px; }
    .impa .block { border: 1px solid currentColor; border-radius: 11px; padding: 9px; margin: 9px 0; border-color: color-mix(in srgb, currentColor 30%, transparent); }
    .impa summary { cursor:pointer; font-size:.9rem; }
    .impa .small { font-size:.78rem; opacity:.75; }
    .impa .status { white-space:pre-wrap; padding:8px 0; font-size:.82rem; }
    .impa button.warn { color:#df8989; }
    .impa .search-results { margin: 10px 0 18px; }
    .impa .search-result { padding:9px; margin:8px 0; border:1px solid color-mix(in srgb,currentColor 24%, transparent); border-radius:9px; }
    .impa .search-result summary { font-weight:600; }
    .impa .search-preview { min-height:150px; font-size:.85rem; line-height:1.6; }
    .impa .tag-warn { font-size:.75rem; opacity:.78; margin-top:4px; }
  `;
  root.append(style);
  const shell = document.createElement('div'); shell.className = 'impa'; root.append(shell);
  const section = document.createElement('div'); shell.append(section);
  const searchPanel = document.createElement('div'); shell.append(searchPanel);
  const live = document.createElement('div'); live.className = 'status'; live.setAttribute('aria-live','polite'); shell.append(live);
  const list = document.createElement('div'); shell.append(list);
  let activeRoom = '', busy = false, roomState = null, semanticState = null, connections = [];
  let searchQuery = '', recentContext = '', includeChanged = false, searchResult = null, rawResult = null, previewResult = null;
  const entryElements = new Map();
  let seq = 0, disposed = false;
  const requests = new Map();
  const onBackend = ctx.onBackendMessage(msg => {
    const pending = requests.get(msg?.requestId);
    if (!pending) return;
    requests.delete(msg.requestId); clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.data);
    else pending.reject(new Error(msg.error || 'backend error'));
  });
  function rpc(method, path, body = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `impa-${++seq}`;
      const timer = setTimeout(() => { requests.delete(requestId); reject(new Error('백엔드 응답 시간이 초과됐습니다.')) }, 240000);
      requests.set(requestId, { resolve, reject, timer });
      try { ctx.sendToBackend({ type:'api', requestId, method, path, body }); }
      catch (e) { clearTimeout(timer); requests.delete(requestId); reject(e); }
    });
  }
  const roomNow = () => {
    try { const c = ctx.getActiveChat?.(); if (c?.chatId) return c.chatId; } catch {}
    try { return ctx.state?.get?.('chat.active')?.chatId || ''; } catch { return ''; }
  };
  const roomUrl = suffix => `rooms/${encodeURIComponent(activeRoom)}${suffix || ''}`;
  const el = (tag, text = '', cls = '') => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (label, handler, warn = false) => {
    const b = el('button', label, warn ? 'warn' : '');
    b.disabled = busy;
    b.addEventListener('click', () => void run(handler));
    return b;
  };
  const status = message => { live.textContent = message; };
  async function run(fn) {
    if (busy || disposed) return;
    busy = true;
    root.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await fn(); }
    catch (e) { status(`오류: ${e?.message || e}`); }
    finally { busy = false; root.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  }
  function selectConnection(name, selected) {
    const select = el('select');
    const empty = el('option', '모델 연결을 선택하세요'); empty.value = ''; select.append(empty);
    for (const c of connections) {
      const op = el('option', `${c.name || c.model || c.id} · ${c.provider || ''}`);
      op.value = c.id; select.append(op);
    }
    select.value = selected || '';
    select.addEventListener('change', () => void run(async () => {
      await rpc('POST', roomUrl('/settings'), { [name]: select.value || null });
      status('설정을 저장했습니다.'); await refresh();
    }));
    return select;
  }
  async function refresh() {
    if (disposed) return;
    const previous = activeRoom;
    activeRoom = roomNow();
    if (!activeRoom) {
      roomState = null; semanticState = null; section.replaceChildren(el('p','먼저 RP 채팅방을 열어 주세요.')); searchPanel.replaceChildren(); list.replaceChildren(); return;
    }
    if (!connections.length) connections = await rpc('GET','connections');
    roomState = await rpc('GET', roomUrl());
    try {semanticState=await rpc('GET',roomUrl('/semantic/status'));} catch {semanticState=null;}
    if (previous !== activeRoom) { status(''); searchQuery=''; recentContext=''; includeChanged=false; searchResult=null; rawResult=null; previewResult=null; }
    render();
  }
  function render() {
    section.replaceChildren(); searchPanel.replaceChildren(); list.replaceChildren(); entryElements.clear();
    if (!roomState) return;
    renderTestNotes();
    renderRoomControls();
    renderMemoryCards();
  }

  // UI composition: keep each panel self-contained while retaining one
  // shared RP-room state and the original lazy memory-card hydration policy.
  function renderTestNotes() {
    const demo = el('div', '', 'block');
    demo.append(el('h3','🧪 테스트 기억 추가 (API 비용 없음)'));
    demo.append(el('p','실제 RP 없이 저장·검색을 확인하는 시험용 기억입니다. 실제 RP 자동 주입 대상에는 절대 포함되지 않습니다.', 'small'));
    const demoText = el('textarea');
    demoText.value='덱스터와 예진은 첫 데이트에서 아이스크림을 먹었다. 덱스터는 바닐라를, 예진은 피스타치오를 골랐다. 덱스터는 예진의 피스타치오 아이스크림을 한입 맛보았다.';
    demo.append(demoText);
    const demoBar = el('div','','bar');
    demoBar.append(button('테스트 기억 저장', async () => {
      await rpc('POST',roomUrl('/test-notes'),{text:demoText.value});
      await refresh(); status('시험용 기억을 저장했습니다. 아래 기억 검색에서 피스타치오를 입력해 보세요.');
    }));
    demo.append(demoBar);
    const notes = roomState.testNotes || [];
    demo.append(el('p',`이 방의 테스트 기억 ${notes.length}개 (실제 RP에는 주입 안 함)`, 'small'));
    for (const note of notes) {
      const item = el('div','','block');
      item.append(el('p',note.summary.text,'small'));
      item.append(button('이 테스트 기억 삭제', async () => {
        if (!window.confirm('이 시험용 기억만 삭제할까요?')) return;
        await rpc('POST',roomUrl(`/test-notes/${encodeURIComponent(note.id)}/delete`));
        await refresh(); status('시험용 기억을 삭제했습니다.');
      },true));
      demo.append(item);
    }
    section.append(demo);
  }

  function renderRoomControls() {
    const interval = roomState.settings.manualSummaryWindowTurns ?? 7;
    section.append(el('h3',`${interval}턴 수동 요약`));
    section.append(el('div', `완결된 턴 ${roomState.completeTurnCount}개 · 새 요약 가능 ${roomState.readyRanges.length}블록 · 잔여 ${roomState.pendingTurns}턴`, 'info'));
    section.append(el('label','상세 요약 모델 연결 (Gemma 등)'));
    section.append(selectConnection('summaryConnectionId', roomState.settings.summaryConnectionId));
    section.append(el('label','검색 태깅 모델 연결 (ScaleDown 등 · 한영 검색 단서 1회 생성)'));
    section.append(selectConnection('tagConnectionId', roomState.settings.tagConnectionId));
    section.append(el('label','한국어 기억 표시 번역 모델 연결 (영어 정본과 별도 · 수동 생성)'));
    section.append(selectConnection('translationConnectionId', roomState.settings.translationConnectionId));
    section.append(el('label','기억 수정 판단 모델 (Jev 등 · 한국어 변경 시 수동 호출)'));
    section.append(selectConnection('decisionConnectionId', roomState.settings.decisionConnectionId));
    section.append(el('label','요약 간격 (방별 설정 · 기본 7턴)'));
    const intervalInput = el('input'); intervalInput.type = 'number'; intervalInput.min = '3'; intervalInput.max = '30'; intervalInput.step = '1';
    intervalInput.value = String(interval); section.append(intervalInput);
    section.append(button('요약 간격 저장', async () => {
      await rpc('POST', roomUrl('/settings'), { manualSummaryWindowTurns: Number(intervalInput.value) });
      await refresh(); status('새 요약 간격을 저장했습니다. 기존 기억 구간은 변경되지 않습니다.');
    }));
    section.append(el('div', '저장된 기존 블록은 그대로 유지합니다. 예전에 실패한 빈 구간은 중간에 끊기지 않도록 별도로 복구합니다. 자동 모델 호출은 하지 않습니다.', 'small'));
    section.append(el('label','턴 계산 방식 (기억 생성 전만 변경 가능)'));
    const turnSelect = el('select');
    for (const [value,label] of [['exchange','사용자+캐릭터 왕복 1회 = 1턴'],['eligible_message','원문 메시지 1개 = 1턴']]) {
      const opt=el('option',label); opt.value=value; turnSelect.append(opt);
    }
    turnSelect.value = roomState.settings.turnDefinition;
    turnSelect.disabled = roomState.coverage.length > 0;
    turnSelect.addEventListener('change', () => void run(async () => {
      await rpc('POST',roomUrl('/settings'), { turnDefinition:turnSelect.value });
      await refresh(); status('턴 계산 방식을 변경했습니다.');
    }));
    section.append(turnSelect);
    section.append(el('div','현 단계에서는 숨김 메시지를 원문에 포함합니다. OOC·분기·스와이프 세부 정책은 통합 테스트 전까지 확정하지 않았습니다.', 'small'));
    const recallSettings = el('div','', 'block');
    recallSettings.append(el('h3','실제 RP 생성 시 기억 주입'));
    recallSettings.append(el('p','방별 선택 기능 · 기본 OFF. 켜진 방에서만 실제 RP 생성 직전에 현재 메시지를 이용해 저장된 상세 기억을 검색합니다. API 키가 없으면 무료 로컬 검색. Nemotron을 설정하면 외부 API 비용이 발생할 수 있습니다.', 'small'));
    const enabled = roomState.settings.recallEnabled === true;
    const optin = el('div','', 'bar');
    optin.append(button(enabled ? '자동 주입 끄기' : '이 방에서 자동 주입 켜기', async () => {
      await rpc('POST',roomUrl('/settings'), {recallEnabled:!enabled});
      await refresh(); status(!enabled ? '이 방의 RP 생성에만 메모리 검색 주입이 적용됩니다.' : '이 방의 자동 기억 주입을 껐습니다.');
    }));
    recallSettings.append(optin);
    recallSettings.append(el('p',enabled ? '현재 상태: ON · Prompt Breakdown에서 주입 내용을 확인할 수 있습니다.' : '현재 상태: OFF · 요약과 수동 검색은 그대로 이용할 수 있습니다.', 'small'));
    const rawEnabled=roomState.settings.rawRecallEnabled===true;
    recallSettings.append(el('p','C.15 원문 후보 자동 주입 · 실험적 / 기본 OFF. 구체적인 검색 단서가 있고 중복·모호함이 적을 때만 실제 RP 원문을 인용합니다. 사실 확인이나 동일 사물 판정은 아닙니다. 최대 추가 2,200바이트, 전체 주입 상한 유지. 추가 AI 호출 없음.', 'small'));
    recallSettings.append(button(rawEnabled?'원문 후보 자동 주입 끄기':'원문 후보 자동 주입 켜기',async()=>{
      await rpc('POST',roomUrl('/settings'),{rawRecallEnabled:!rawEnabled});
      await refresh();status(!rawEnabled?'원문 후보 실험 주입을 켰습니다. 기본 기억 주입도 켜져 있어야 동작합니다.':'원문 후보 주입을 껐습니다.');
    }));
    recallSettings.append(el('p',rawEnabled?'원문 후보 추가: ON · 기존 기억 자동 주입도 ON이어야 작동':'원문 후보 추가: OFF · 기존 수동 원문 검색은 계속 사용 가능','small'));
    const detailLabel=el('label','기억 주입 방식 (기존 전체 요약 / 실험적 관련 문장 발췌)');
    const detailSelect=el('select');
    for(const [value,label] of [['full','전체 상세 요약 (기존 방식)'],['focused','관련 대목 중심 (실험적 · 정확한 영어 문장만)']]){
      const opt=el('option',label); opt.value=value; detailSelect.append(opt);
    }
    detailSelect.value=roomState.settings.recallDetailMode||'full';
    detailSelect.addEventListener('change',()=>void run(async()=>{
      await rpc('POST',roomUrl('/settings'),{recallDetailMode:detailSelect.value});
      await refresh();status('기억 주입 방식을 변경했습니다. 원본 기억 데이터는 변경하지 않습니다.');
    }));
    recallSettings.append(detailLabel,detailSelect);
    recallSettings.append(el('p','관련 대목 모드는 영어 정본의 문장을 그대로 발췌합니다. 연결 단서를 찾지 못하면 전체 요약으로 되돌아갑니다. 단, C.12 국소 검색 사용 시 태그만 일치하는 무근거 블록은 제외합니다.', 'small'));
    const localLabel=el('label','C.12 국소 사건 검색 보강 (추가 AI 호출 없음 · 실험)');
    const localSelect=el('select');
    for (const [value,label] of [['off','끄기 · C.11 기존 검색'],['on','켜기 · 같은 장면 안의 단서 결합 우선']]) {
      const option=el('option',label);option.value=value;localSelect.append(option);
    }
    localSelect.value=roomState.settings.localPassageSearch===true?'on':'off';
    localSelect.addEventListener('change',()=>void run(async()=>{
      await rpc('POST',roomUrl('/settings'),{localPassageSearch:localSelect.value==='on'});
      await refresh();status('국소 사건 검색 설정을 저장했습니다. 추가 모델 호출 및 기존 벡터 생성은 없습니다.');
    }));
    recallSettings.append(localLabel,localSelect);
    recallSettings.append(el('p','기본 OFF. 원본 영어 요약을 변경하지 않고 장면 안에서 함께 등장하는 단서에 가중치를 줍니다. 한국어 형태소 분석이나 번역 모델을 새로 설치하지 않습니다.', 'small'));
    const byteLabel = el('label','주입 UTF-8 바이트 상한 (1000–9500 · 정확한 토큰 수 아님)');
    const byteInput=el('input'); byteInput.type='number'; byteInput.min='1000';byteInput.max='9500';byteInput.step='500';
    byteInput.value=String(roomState.settings.recallMaxBytes ?? 8500);
    recallSettings.append(byteLabel,byteInput);
    const countLabel=el('label','한 번에 선택할 기억 최대 개수 (1–20)');
    const countInput=el('input');countInput.type='number';countInput.min='1';countInput.max='20'; countInput.step='1';
    countInput.value=String(roomState.settings.recallLimit ?? 8);
    recallSettings.append(countLabel,countInput);
    recallSettings.append(button('주입 상한 저장', async () => {
      await rpc('POST',roomUrl('/settings'),{recallMaxBytes:Number(byteInput.value), recallLimit:Number(countInput.value)});
      await refresh();status('기억 주입 상한을 저장했습니다.');
    }));
    recallSettings.append(el('p','주입 시 원문이 변경되거나 삭제된 기억, 오래된 태그, 현재 프롬프트에 원문이 이미 포함된 기억은 제외합니다. 바이트 한도는 10K 토큰을 직접 측정한 결과가 아니며 전체 50K 컨텍스트도 검증하지 않습니다.', 'small'));
    section.append(recallSettings);
    renderSemanticControls();

    const bar = el('div','', 'bar');
    bar.append(button('새로고침', async () => { await refresh(); status('최신 상태를 불러왔습니다.'); }));
    bar.append(button(`${interval}턴 단위 일괄 요약`, async () => {
      if (!roomState.settings.summaryConnectionId) throw new Error('상세 요약 모델 연결을 먼저 선택해 주세요.');
      if (!roomState.readyRanges.length) { status('요약 가능한 새 구간이 없습니다.'); return; }
      status('수동 요약을 실행하고 있습니다. 중간에 실패한 블록은 다음 실행 때 다시 시도할 수 있어요.');
      const result = await rpc('POST', roomUrl('/summarize'));
      await refresh(); status(`새 요약 ${result.created.length}개 · 실패 ${result.failed.length}개 · 대기 ${result.pendingTurns}턴\n${result.failed.map(f=>`${f.range}: ${f.error}`).join('\n')}`);
    }));
    bar.append(button('한영 검색 단서 일괄 생성', async () => {
      const ids = roomState.blocks.filter(b => b.canonicalStatus === 'ready' && (b.tagging.status === 'missing' || b.tagging.status === 'stale' || !b.tagging.bilingual?.ko?.length || !b.tagging.bilingual?.en?.length))
        .filter(b => !b.tagging.editedByUser).map(b => b.id);
      if (!ids.length) { status('태깅할 블록이 없습니다.'); return; }
      if (!roomState.settings.tagConnectionId) throw new Error('태깅 모델 연결을 먼저 선택해 주세요.');
      status('선택한 블록들의 태깅을 처리하고 있습니다.');
      const result = await rpc('POST', roomUrl('/tag'), { blockIds: ids });
      await refresh(); status(`태깅 ${result.tagged.length}개 · 제외 ${result.skipped.length}개 · 실패 ${result.failed.length}개`);
    }));
    bar.append(button('한국어 번역 캐시 일괄 생성', async () => {
      const ids=roomState.blocks.filter(b=>b.canonicalStatus==='ready' && !b.translation?.ko?.editedByUser)
        .filter(b=>b.translation?.ko?.status!=='ready' || b.translation?.ko?.sourceSummaryRevision!==b.summary.revision).map(b=>b.id);
      if (!ids.length) {status('번역할 기억이 없습니다.');return;}
      if (!roomState.settings.translationConnectionId) throw new Error('한국어 번역 모델 연결을 먼저 선택해 주세요.');
      status('선택한 기억의 한국어 표시 번역을 생성합니다. 영어 정본은 변경하지 않습니다.');
      const result=await rpc('POST',roomUrl('/translate-ko'),{blockIds:ids});
      await refresh();status(`한국어 번역 ${result.translated.length}개 · 제외 ${result.skipped.length}개 · 실패 ${result.failed.length}개\n${result.failed.map(f=>`${f.id}: ${f.error}`).join('\n')}`);
    }));
    section.append(bar);
    renderNarrativeControls();
    renderSearch();
  }

  function renderMemoryCards() {
    list.append(el('h3',`상세 기억 ${roomState.blocks.length}개`));
    const pendingLegacy = roomState.blocks.filter(b => b.canonicalStatus === 'legacy_requires_review').length;
    if (pendingLegacy) list.append(el('p',`구형 기억 ${pendingLegacy}개는 원어를 확정할 수 없어 영어 정본으로 자동 지정하지 않았습니다. 원문은 보존되며, 영어 요약을 확인해서 수동 등록할 때까지 RP 자동 주입에서 제외됩니다.`, 'tag-warn'));
    const sorted = [...roomState.blocks].sort((a,b)=>a.range.startTurn-b.range.startTurn);
    for (const b of sorted) {
      const box = el('details','', 'block');
      const summary = el('summary', `${b.protection?.locked?'🔒 ':''}${b.title || `기억 ${String(b.range.startTurn).padStart(3,'0')} · ${b.range.startTurn}–${b.range.endTurn}턴`}  · 태그 ${b.tagging.status}${b.sourceStatus !== 'unchanged' ? ` · ${b.sourceStatus}` : ''}${b.pendingReview?' · 수정 검토 대기':''}`);
      box.append(summary);
      // Mobile: build editor textareas/buttons only after the user opens a card.
      // Closed cards remain cheap even with hundreds of stored memories.
      let hydrated = false;
      box.addEventListener('toggle', () => {
        if (!box.open || hydrated) return;
        hydrated = true;
        const isLegacy = b.canonicalStatus === 'legacy_requires_review';
        const locked = b.protection?.locked === true;
        const lockBar=el('div','','bar');
        lockBar.append(button(locked?'🔓 기억 잠금 해제':'🔒 기억 잠금',async()=>{
          if(!window.confirm(locked?'기억을 잠금 해제할까요?':'이 기억을 잠가 모델 생성과 수동 변경을 막을까요? (검색·RP 회상은 계속 가능)'))return;
          await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/lock`),{
            locked:!locked,expectedLocked:locked,expectedRevision:b.summary.revision});
          await refresh();status(locked?'기억 잠금을 해제했습니다.':'기억을 잠갔습니다.');
        }));
        box.append(lockBar);
        if(locked){
          box.append(el('p','이 기억은 잠겨 있어 수정·삭제·번역 갱신을 하지 않습니다. 기존 기억 검색은 가능합니다. 수정하려면 잠금을 해제하세요.','tag-warn'));
          box.append(el('label','영어 정본 · 읽기 전용'));
          box.append(el('p',b.summary.text,'small'));
          if(b.translation?.ko?.text){
            box.append(el('label','한국어 번역 · 읽기 전용'));
            box.append(el('p',b.translation.ko.text,'small'));
          }
        }
        if(!locked){
        box.append(el('p', `요약 rev.${b.summary.revision} · 언어 ${isLegacy?'미확인(구형)':(b.summary.language || '미확인')} · 출처 ${b.sourceStatus}`, 'small'));
        if (isLegacy) {
          box.append(el('p','이전 요약은 한국어일 수 있어 자동 영어 정본으로 표시하지 않습니다. 아래에 직접 검수한 영어 요약을 등록해야 RP 주입 대상으로 전환됩니다.', 'tag-warn'));
          const promoted = el('textarea'); promoted.placeholder='Reviewed English factual summary (required for promotion)'; box.append(promoted);
          box.append(button('검수한 영어 요약을 정본으로 등록', async () => {
            if (!window.confirm('기존 요약은 기록으로 보존됩니다. 검수한 영어 요약을 새 정본으로 등록할까요?')) return;
            await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/promote-english`),{text:promoted.value, expectedRevision:b.summary.revision});
            await refresh(); status('영어 정본을 등록했습니다. 이전 요약은 legacySource 및 안전 백업에 보존됩니다.');
          }));
        }
        box.append(el('label',isLegacy ? '이전 요약 (언어 미확인 · 내용 수정 시에도 영어 정본으로 자동 승격하지 않음)' : '영어 기준 상세 요약 (정본 수정 시 번역·태그는 오래된 상태가 됨)'));
        const summaryEdit = el('textarea'); summaryEdit.value = b.summary.text; box.append(summaryEdit);
        const sb = button(isLegacy ? '구형 요약 수정 저장' : '영어 정본 수정 저장', async () => {
          await rpc('POST', roomUrl(`/blocks/${encodeURIComponent(b.id)}/edit`), { text:summaryEdit.value, expectedRevision:b.summary.revision });
          await refresh(); status('상세 요약을 저장했습니다. 기존 태그는 필요할 경우 재태깅 상태로 표시됩니다.');
        }); box.append(sb);
        if (!isLegacy) {
          const cache=b.translation?.ko || {};
          const isReady=cache.status==='ready' && cache.sourceSummaryRevision===b.summary.revision;
          box.append(el('label',`한국어 표시 캐시 · ${isReady?'최신':cache.status||'미생성'} · 캐시 rev.${cache.revision||0}${cache.editedByUser?' · 사용자 편집 보호':''}`));
          box.append(el('p','한국어를 고친 뒤 판단 모델로 검토하면, 표시만 수정할지 영어 사실도 바꿀지 제안을 볼 수 있어요. 승인 전에는 원래 기억을 바꾸지 않습니다.', 'small'));
          const translationEdit=el('textarea');translationEdit.value=cache.text||'';
          translationEdit.placeholder='한국어 번역 캐시가 없습니다. 한국어 번역을 생성하거나 직접 입력하세요.';
          box.append(translationEdit);
          box.append(button('한국어 수정안 검토 요청 (모델 호출)', async()=>{
            if (!roomState.settings.decisionConnectionId) throw new Error('먼저 기억 수정 판단 모델을 선택해 주세요.');
            const proposal=await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/review-ko`),{
              text:translationEdit.value,expectedSummaryRevision:b.summary.revision,expectedCacheRevision:cache.revision||0});
            await refresh();status(`검토 제안을 저장했습니다: ${proposal.decision}. 기억은 아직 변경되지 않았어요.`);
          }));
          const proposal=b.pendingReview;
          if(proposal){
            const panel=el('div','','block');
            const desc=proposal.decision==='display_only'?'표현만 수정 · 영어 정본 유지':proposal.decision==='meaning_changed'?'사실 변경 · 영어 정본 수정안 확인 필요':'불확실 · 자동 적용 불가';
            panel.append(el('h3',`📋 한국어 수정 검토: ${desc}`));
            panel.append(el('p',proposal.reasonKo||'모델 설명 없음','small'));
            panel.append(el('label','적용될 한국어 표시본'));
            panel.append(el('p',proposal.proposedKorean,'small'));
            if(proposal.decision==='meaning_changed'){
              panel.append(el('label','⚠️ 제안된 영어 정본 (승인 전 꼼꼼히 확인)'));
              panel.append(el('p',proposal.englishCandidate||'영어 수정안 없음','small'));
              const before=el('details');before.append(el('summary','기존 영어 정본 비교'));before.append(el('p',proposal.oldEnglish,'small'));panel.append(before);
            }
            const bar=el('div','','bar');
            if(proposal.decision!=='uncertain')bar.append(button('이 수정안 승인·적용',async()=>{
              if(!window.confirm(proposal.decision==='meaning_changed'?'영어 정본도 바뀌며 이후 RP 기억에 반영됩니다. 영어 변경 내용을 확인하고 승인할까요?':'한국어 표시·검색만 수정하고 영어 정본은 유지할까요?'))return;
              const result=await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/review-ko/approve`),{
                proposalId:proposal.id,expectedSummaryRevision:b.summary.revision,expectedCacheRevision:cache.revision||0});
              await refresh();status(result.englishChanged?'영어 정본과 한국어 번역을 함께 수정했습니다.':'한국어 표시·검색만 수정했습니다.');
            }));
            bar.append(button('수정 제안 취소',async()=>{
              await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/review-ko/cancel`),{proposalId:proposal.id});
              await refresh();status('수정 제안을 취소했습니다. 원래 기억은 그대로입니다.');
            }));
            panel.append(bar);box.append(panel);
          }
          box.append(button('한국어 표시 캐시만 수정 저장', async()=>{
            if (!window.confirm('이 변경은 한국어 표시·검색에만 반영됩니다. 영어 정본에는 반영되지 않습니다. 저장할까요?')) return;
            await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/translation-ko`),{
              text:translationEdit.value,expectedSummaryRevision:b.summary.revision,expectedCacheRevision:cache.revision||0});
            await refresh();status('한국어 표시·검색 캐시만 수정했습니다. 영어 정본은 변경되지 않았습니다.');
          }));
        }
        if (b.tagging.bilingual?.ko?.length && b.tagging.bilingual?.en?.length) {
          box.append(el('p',`한국어 검색 단서: ${b.tagging.bilingual.ko.join(' · ')}`, 'small'));
          box.append(el('p',`English cues: ${b.tagging.bilingual.en.join(' · ')}`, 'small'));
        }
        box.append(el('label','검색 태그 (수동 입력 시 자동 한영 단서 대신 사용)'));
        const tagEdit = el('textarea'); tagEdit.value = b.tagging.text || ''; box.append(tagEdit);
        const tb = button('태그 직접 저장', async () => {
          await rpc('POST', roomUrl(`/blocks/${encodeURIComponent(b.id)}/tags`), { text:tagEdit.value, expectedRevision:b.summary.revision });
          await refresh(); status('수동 태그를 저장했습니다.');
        }); box.append(tb);
        const bb = el('div','', 'bar');
        bb.append(button('제목 변경', async () => {
          const title = window.prompt('기억의 제목 (빈칸은 기본 표시)', b.title || '');
          if (title === null) return;
          await rpc('POST', roomUrl(`/blocks/${encodeURIComponent(b.id)}/title`), { title, expectedRevision:b.summary.revision });
          await refresh(); status('제목을 변경했습니다.');
        }));
        bb.append(button('기억 삭제', async () => {
          if (!window.confirm('이 기억을 검색 대상에서 제외하고 삭제 상태로 바꿀까요? 원문과 저장된 기억은 보존됩니다. 자동 재생성되지 않습니다.')) return;
          await rpc('POST', roomUrl(`/blocks/${encodeURIComponent(b.id)}/delete`), { expectedRevision:b.summary.revision });
          await refresh(); status('기억이 삭제 상태로 변경되었습니다. 같은 범위는 자동 재요약되지 않습니다.');
        }, true));
        box.append(bb);
        } // unlocked edits
        // C.13: read-only source provenance. Never claims sentence candidates
        // are semantically verified; stale spans expose IDs, not current text.
        const traceArea=el('div','','block');
        traceArea.append(button('🔎 원문 출처·근거 후보 확인 (무료)',async()=>{
          const report=await rpc('GET',roomUrl(`/blocks/${encodeURIComponent(b.id)}/source`));
          const display=el('div','','block');
          display.append(el('p',`원문 상태: ${report.sourceStatus} · 턴 ${report.range.startTurn}–${report.range.endTurn}`, 'small'));
          display.append(el('p',report.note,'tag-warn'));
          if(report.sourceStatus==='unchanged'){
            for(const m of report.messages){
              const item=el('details','','search-result');
              item.append(el('summary',`${m.turn}턴 · ${m.role} · ${m.messageId}${m.truncated?' · 길이 제한':''}`));
              item.append(el('p',m.text));display.append(item);
            }
            for(const st of report.statementCandidates){
              const item=el('details','','search-result');
              item.append(el('summary',`요약 문장 ${st.statementIndex+1} · 후보 ${st.candidates.length}개 (의미 검증 아님)`));
              item.append(el('p',st.statement));
              item.append(el('p',st.candidates.length?st.candidates.map(c=>`${c.turn}턴 · ${c.messageId}`).join(', '):'단어 기반 후보 없음 · 실제 원문 누락 확정 아님','small'));
              display.append(item);
            }
          }
          traceArea.querySelectorAll('.c13-source-result').forEach(x=>x.remove());
          display.classList.add('c13-source-result');traceArea.append(display);
          status('C.13 출처를 읽었습니다. 원본 대화나 요약은 수정하지 않았습니다.');
        }));
        box.append(traceArea);
        const historyBox=el('div','','block');
        const historyList=el('div');
        historyBox.append(button('이전 기억 버전 보기',async()=>{
          const data=await rpc('GET',roomUrl(`/blocks/${encodeURIComponent(b.id)}/history`));
          historyList.replaceChildren();
          if(!data.entries.length)historyList.append(el('p','아직 이전 수정 기록이 없습니다.','small'));
          for(const h of data.entries.slice().reverse()){
            const item=el('details','','search-result');
            item.append(el('summary',`${h.action} · 영어 rev.${h.summaryRevision} · ${h.capturedAt}`));
            item.append(el('p',h.englishText,'small'));
            if(h.koreanText)item.append(el('p',`한국어: ${h.koreanText}`,'small'));
            if(!locked&&!isLegacy)item.append(button('이 버전 복원',async()=>{
              if(!window.confirm('현재 기억도 기록으로 남기고, 이 시점의 영어·한국어 내용을 되돌릴까요? 새 버전 번호가 부여됩니다.'))return;
              await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/history/restore`),{
                historyId:h.id,expectedRevision:b.summary.revision,expectedCacheRevision:b.translation?.ko?.revision||0});
              await refresh();status('선택한 이전 기억으로 복원했습니다.');
            }));
            historyList.append(item);
          }
        }));
        historyBox.append(historyList);box.append(historyBox);
      });
      entryElements.set(b.id,box);
      list.append(box);
    }
    renderDeletedMemoryControls();
  }

  function renderDeletedMemoryControls(){
    const deleted=roomState?.deletedBlocks||[];
    if(!deleted.length)return;
    const panel=el('details','','block');panel.append(el('summary',`삭제 상태의 기억 ${deleted.length}개 · 복원 가능`));
    panel.append(el('p','삭제 처리된 기억은 검색·RP 주입에서 제외되지만, 데이터는 남아 있어요.','small'));
    for(const b of deleted){
      const bar=el('div','','block');
      bar.append(el('p',`${b.title||b.id} · ${b.range.startTurn}–${b.range.endTurn}턴${b.protection?.locked?' · 잠김':''}`,'small'));
      if(!b.protection?.locked)bar.append(button('기억 다시 살리기',async()=>{
        if(!window.confirm('이 기억을 다시 검색·RP 회상 대상으로 복원할까요? 원문이 바뀌었다면 검토 대상으로 표시됩니다.'))return;
        await rpc('POST',roomUrl(`/blocks/${encodeURIComponent(b.id)}/restore`),{expectedRevision:b.summary.revision});
        await refresh();status('기억을 다시 활성화했습니다.');
      }));
      panel.append(bar);
    }
    list.append(panel);
  }
  function renderNarrativeControls() {
    const box=el('div','','block');
    box.append(el('h3','📚 챕터 · 아크 (수동 생성)'));
    box.append(el('p','기존 상세 기억은 그대로 둔 채 여러 기록의 이야기 흐름을 하나로 정리합니다. 생성·갱신에는 선택한 AI 모델의 API 비용이 발생할 수 있어요. 자동 요약은 하지 않습니다.', 'small'));
    box.append(el('label','상위 서사 요약 모델 (선택 사항: 지정하지 않으면 상세 요약 모델 사용)'));
    box.append(selectConnection('narrativeConnectionId',roomState.settings.narrativeConnectionId));
    const nodes=(roomState.narratives||[]).filter(n=>n.lifecycle==='active');
    const types=[{kind:'chapter',label:'챕터',children:roomState.blocks.filter(b=>b.canonicalStatus==='ready'&&b.sourceStatus==='unchanged'&&b.lifecycle==='active')},
      {kind:'arc',label:'아크',children:nodes.filter(n=>n.kind==='chapter'&&n.status==='ready')}];
    for(const {kind,label,children} of types){
      const area=el('div','','block');area.append(el('h3',`새 ${label} 만들기`));
      area.append(el('p',kind==='chapter'?'이어지는 상세 기억 2~12개를 묶어 챕터 생성':'이어지는 챕터 2~12개를 묶어 아크 생성','small'));
      const ordered=[...children].sort((a,b)=>a.range.startTurn-b.range.startTurn);
      const pick=(text)=>{
        const select=el('select');
        const empty=el('option',text);empty.value='';select.append(empty);
        for(const c of ordered){const op=el('option',`${c.range.startTurn}–${c.range.endTurn}턴 · ${c.title||c.id}`);op.value=c.id;select.append(op);}
        return select;
      };
      const from=pick('시작 기억'),to=pick('끝 기억');area.append(from,to);
      area.append(button(`${label} 생성`,async()=>{
        const start=ordered.findIndex(n=>n.id===from.value),end=ordered.findIndex(n=>n.id===to.value);
        if(start<0||end<start||end-start+1<2||end-start+1>12)throw new Error('시작부터 끝까지 이어지는 기억 2~12개를 선택해 주세요.');
        const selected=ordered.slice(start,end+1).map(n=>n.id);
        if(!window.confirm(`${label} 하나를 생성할까요? 선택한 ${selected.length}개 기록을 모델에 보내 요약합니다.`))return;
        const result=await rpc('POST',roomUrl('/narratives'),{kind,childIds:selected});
        await refresh();status(`${label} 생성: ${result.title}`);
      }));
      box.append(area);
    }
    box.append(el('h3',`상위 서사 ${nodes.length}개`));
    if(!nodes.length)box.append(el('p','아직 챕터/아크가 없습니다. 생성하지 않아도 상세 기억 검색은 그대로 작동합니다.','small'));
    for(const n of nodes.slice().sort((a,b)=>a.range.startTurn-b.range.startTurn)){
      const item=el('details','','block');
      item.append(el('summary',`${n.kind==='arc'?'아크':'챕터'} · ${n.title} · ${n.range.startTurn}–${n.range.endTurn}턴${n.status==='stale'?' · ⚠ 재검토 필요':''}`));
      item.addEventListener('toggle',()=>{
        if(!item.open||item.dataset.ready)return;item.dataset.ready='1';
        item.append(el('p',n.summary.text,'small'));
        item.append(el('p',`하위 기억: ${(n.childRefs||[]).map(c=>c.id).join(', ')} · 상태: ${n.status} · revision ${n.summary.revision}`,'small'));
        item.append(button('이 서사 다시 생성',async()=>{
          if(!window.confirm('현재 서사를 동일한 하위 기억으로 다시 생성할까요? 이전 버전은 복구 기록에 보존됩니다.'))return;
          const updated=await rpc('POST',roomUrl('/narratives'),{kind:n.kind,childIds:n.childRefs.map(c=>c.id),replaceId:n.id});
          await refresh();status(`서사 갱신: ${updated.title}`);
        }));
        item.append(button('제목 수정',async()=>{
          const title=window.prompt('새 제목',n.title);if(title===null)return;
          await rpc('POST',roomUrl(`/narratives/${encodeURIComponent(n.id)}/title`),{title,expectedRevision:n.summary.revision});
          await refresh();status('상위 서사 제목을 저장했습니다.');
        }));
        item.append(button('서사 카드 삭제',async()=>{
          if(!window.confirm('이 상위 서사 카드만 숨길까요? 원래 상세 기억은 삭제하지 않습니다.'))return;
          await rpc('POST',roomUrl(`/narratives/${encodeURIComponent(n.id)}/delete`),{expectedRevision:n.summary.revision});
          await refresh();status('상위 서사만 삭제 처리했습니다. 하위 기억은 보존됩니다.');
        },true));
      });
      entryElements.set(n.id,item);
      box.append(item);
    }
    section.append(box);
  }
  function renderSemanticControls() {
    const card=el('div','','block');
    card.append(el('h3','의미 검색 · Nemotron (선택적 API 연결)'));
    card.append(el('p','태블릿에서는 기억을 보관하고 검색 순서를 관리해. Nemotron API는 영어 기억의 의미를 검색하고 비슷한 사건 중 관련 있는 기억을 먼저 골라줘. 키가 없으면 기존 무료 검색이 작동해.', 'small'));
    if(semanticState) card.append(el('p',`저장된 영어 기억 ${semanticState.total}개 · 의미 검색 준비 ${semanticState.indexed}개 · 아직 준비 안 됨 ${semanticState.pending}개 · API 키 ${semanticState.configured?'등록됨':'미등록'}`, 'small'));
    else card.append(el('p','의미 검색 상태를 읽지 못했습니다. 기존 검색은 계속 사용할 수 있습니다.', 'tag-warn'));
    const hasKey=Boolean(semanticState?.configured);
    const keyInput=el('input'); keyInput.type='password';keyInput.autocomplete='off';keyInput.placeholder='DeepInfra API 키 (화면에 저장하지 않음)';
    card.append(keyInput);
    const keyBar=el('div','','bar');
    keyBar.append(button('API 키 안전 저장',async()=>{
      const value=keyInput.value;keyInput.value='';
      await rpc('POST',roomUrl('/semantic/key'),{key:value});
      await refresh();status('API 키를 Lumiverse 암호화 저장소에 보관했습니다. 기억 백업에는 포함되지 않습니다.');
    }));
    if(hasKey) keyBar.append(button('API 키 삭제',async()=>{
      if(!window.confirm('DeepInfra API 키만 삭제할까요? 기억 카드와 검색 색인은 그대로 둡니다.'))return;
      await rpc('POST',roomUrl('/semantic/key/delete'));
      await refresh();status('API 키가 삭제되었습니다. 무료 로컬 검색으로 작동합니다.');
    }));
    card.append(keyBar);
    const searchEnabled=roomState.settings.semanticEnabled!==false;
    const rankEnabled=roomState.settings.rerankEnabled!==false;
    const toggles=el('div','','bar');
    toggles.append(button(searchEnabled?'의미 검색 끄기':'의미 검색 켜기',async()=>{
      await rpc('POST',roomUrl('/settings'),{semanticEnabled:!searchEnabled});await refresh();
    }));
    toggles.append(button(rankEnabled?'리랭커 끄기':'리랭커 켜기',async()=>{
      await rpc('POST',roomUrl('/settings'),{rerankEnabled:!rankEnabled});await refresh();
    }));
    card.append(toggles);
    card.append(el('label','임베딩 모델 (변경하면 해당 모델용 검색 색인을 새로 만들어야 함)'));
    const modelSelect=el('select');
    for(const [value,label] of [
      ['nvidia/Nemotron-3.5-Embed-1B-BF16','Nemotron 3.5 Embed 1B · 저렴한 기본값'],
      ['nvidia/Nemotron-3.5-Embed-8B-BF16','Nemotron 3.5 Embed 8B · 정확도 비교용']]) {
      const option=el('option',label);option.value=value;modelSelect.append(option);
    }
    modelSelect.value=roomState.settings.embeddingModel||'nvidia/Nemotron-3.5-Embed-1B-BF16';
    modelSelect.addEventListener('change',()=>void run(async()=>{
      await rpc('POST',roomUrl('/settings'),{embeddingModel:modelSelect.value});await refresh();status('모델을 바꿨습니다. 새로운 모델용 색인을 생성해야 의미 검색에 사용됩니다.');
    }));card.append(modelSelect);
    card.append(el('label','벡터 저장 크기 (512 기본 · 늘리면 저장 용량 증가)'));
    const dimensionSelect=el('select');
    for(const dim of [512,1024,2048]) {const op=el('option',String(dim));op.value=String(dim);dimensionSelect.append(op);}
    dimensionSelect.value=String(roomState.settings.embeddingDimensions||512);
    dimensionSelect.addEventListener('change',()=>void run(async()=>{
      await rpc('POST',roomUrl('/settings'),{embeddingDimensions:Number(dimensionSelect.value)});await refresh();status('저장 크기가 변경됐습니다. 해당 크기로 재색인이 필요합니다.');
    }));card.append(dimensionSelect);
    card.append(button('준비되지 않은 기억 최대 24개 색인 만들기',async()=>{
      if(!hasKey)throw new Error('먼저 DeepInfra API 키를 등록해 주세요.');
      const result=await rpc('POST',roomUrl('/semantic/index'));
      await refresh();status(`의미 검색 색인 생성 ${result.indexed.length}개 · 제외 ${result.skipped.length}개 · 실패 ${result.failed.length}묶음${result.failed.length?'\n'+result.failed.map(x=>x.error||x.reason).join('\n'):''}`);
    }));
    card.append(el('p','이미 준비된 기억은 다시 임베딩하지 않아. 새 영어 기억은 요약할 때 색인을 만들고, 기억을 수정하면 해당 카드만 다시 만들 수 있어. 외부 API 비용이 발생하므로 자동 무한 재시도는 하지 않아.', 'small'));
    section.append(card);
  }
  function renderSearch() {
    searchPanel.replaceChildren();
    searchPanel.append(el('h3','기억 검색 · 원문 직접 검색'));
    searchPanel.append(el('p','기존 상세 기억 검색은 그대로 유지해. 별도의 원문 직접 검색은 요약·태그가 없어도 현재 RP 원문 메시지를 찾는 무료 로컬 검색이야. 원문 색인은 변경 시 다시 생성되며, 현재 RP 자동 주입에는 연결하지 않았어. 현재 방의 영어 상세 정본·한국어 표시 캐시·한영 검색 단서를 로컬 검색합니다. 한국어 형태소는 규칙 기반 휴리스틱과 N-gram입니다(전용 WASM 분석기 미탑재). Nemotron API 키를 등록하면 의미 검색과 리랭커가 추가됩니다(유료 호출 가능). 키가 없거나 오류가 나면 기존 검색으로 돌아갑니다. 미리보기는 확인용이고 실제 RP 주입은 방별 설정에 따릅니다.', 'small'));
    const q = el('input'); q.type='search'; q.placeholder='예: 첫 데이트 때 고른 아이스크림 맛'; q.value=searchQuery;
    q.addEventListener('input', () => { searchQuery=q.value; });
    q.addEventListener('keydown', ev => { if(ev.key==='Enter') { ev.preventDefault(); void run(performSearch); } });
    searchPanel.append(q);
    const context = el('input'); context.type='text'; context.placeholder='선택: 모호한 질문을 위한 최근 대화 단서'; context.value=recentContext;
    context.addEventListener('input',()=>{ recentContext=context.value; });
    searchPanel.append(el('label','최근 대화 참고 (선택, 최대 2,000자)')); searchPanel.append(context);
    const lab=el('label');
    const check=el('input'); check.type='checkbox'; check.style.width='auto'; check.checked=includeChanged;
    check.addEventListener('change',()=>{includeChanged=check.checked;});
    lab.append(check,document.createTextNode(' 원문이 변경된 기억도 검색 (검토 목적)'));
    searchPanel.append(lab);
    const actions=el('div','', 'bar');
    actions.append(button('기억 검색',performSearch));
    actions.append(button('원문 직접 검색 · 무료',performRawSearch));
    actions.append(button('주입 내용 미리보기',performPreview));
    searchPanel.append(actions);
    const box=el('div','', 'search-results'); searchPanel.append(box);
    if (rawResult) {
      box.append(el('h3','원문 검색 결과 · 요약 누락 복구 후보'));
      box.append(el('p',`원문 ${rawResult.results.length}건 · ${rawResult.indexedPassages}개 구간 색인 · 추가 AI 호출 0회 · 본문은 현재 채팅에서 읽음`, 'small'));
      box.append(el('p','이 결과는 글자가 일치하는 원문 후보야. 사건의 의미나 원인까지 검증한 결과는 아니며 RP에 자동 삽입되지 않아.', 'tag-warn'));
      for(const hit of rawResult.results) {
        const item=el('details','','search-result');
        item.append(el('summary',`${hit.turn}턴 · ${hit.role==='user'?'사용자':'캐릭터'} · 원문 후보`));
        item.append(el('p',hit.excerpt));
        item.append(el('p',`메시지 ID ${hit.sourceMessageId} · 일치 단서 ${hit.matchedClues.join(', ')}`, 'small'));
        box.append(item);
      }
      if(!rawResult.results.length)box.append(el('p','일치하는 원문 후보가 없습니다. 한영 검색은 제한된 로컬 대응어만 지원해. 더 구체적인 원문 단서로 검색해 보세요.', 'small'));
    }
    if (searchResult) {
      box.append(el('p',`검색된 기억 ${searchResult.results.length}개 · 검색 방식 ${searchResult.retrievalMode||'로컬 어휘'}${searchResult.rerankUsed?' · 리랭커 적용':''}${searchResult.localPassageSearchUsed?' · 국소 사건 검색':''} · 모델 호출 ${searchResult.modelCalls||0}회${searchResult.contextUsed?' · 최근 문맥 참조':''}`, 'small'));
      for (const hit of searchResult.results) {
        const details=el('details','', 'search-result');
        details.append(el('summary',`${hit.title} · 점수 ${hit.score.toFixed(2)}`));
        details.append(el('p',`${hit.testOnly?'시험용 · RP 주입 제외':`${hit.range.startTurn}–${hit.range.endTurn}턴`} · 일치: ${hit.matchedFields.join(', ')}${hit.matchedViaTagOnly?' · 태그 단서만 일치':''}${hit.matchedViaBilingual?' · 한영 대응어 일치':''}${hit.matchedViaMorphology?' · 형태 변화 보정':''}${hit.contextOnly?' · 최근 문맥 기반의 낮은 확신':''}${hit.sourceStatus!=='unchanged'?' · 원문 검토 필요: '+hit.sourceStatus:''}`, 'small'));
        if (hit.displayText) {
          details.append(el('p',hit.displayText));
          const original=el('details');original.append(el('summary','영어 정본 보기'));original.append(el('p',hit.text));details.append(original);
        } else {details.append(el('p',hit.text));}
        if (hit.identicalMemoryIds.length) details.append(el('p',`동일한 요약 ${hit.identicalMemoryIds.length}개는 결과에서 묶음: ${hit.identicalMemoryIds.join(', ')}`, 'small'));
        if(!hit.testOnly){
          const diagnostic=el('div','','block');
          const fact=el('input');fact.placeholder='선택: 원문과 대조할 정확한 문구 (영어 등)';
          diagnostic.append(el('p','C.13 단계별 진단 · 무료 로컬 검색만 시험. Nemotron 및 RP 모델의 실제 결과는 측정하지 않음.', 'small'));
          diagnostic.append(fact);
          diagnostic.append(button('이 기억의 기록→검색→주입 검사',async()=>{
            const report=await rpc('POST',roomUrl('/diagnose'),{
              query:searchQuery,recentText:recentContext,expectedBlockId:hit.id,expectedFact:fact.value,
              recallDetailMode:roomState.settings.recallDetailMode||'full',
              localPassageSearch:roomState.settings.localPassageSearch===true});
            const result=el('div','','block');
            result.append(el('p',`원문 출처: ${report.sourceStatus}`));
            result.append(el('p',`기록: ${report.recording.literalCheck} · 원문 문구: ${report.recording.originalLiteralCheck}`));
            result.append(el('p',`검색: ${report.retrieval.status} · 순위: ${report.retrieval.rank??'없음'}`));
            result.append(el('p',`RP 주입 조립: ${report.delivery.status} · 문구: ${report.delivery.recordingInPacket}`));
            result.append(el('p',report.recording.caveat+' '+report.retrieval.caveat,'tag-warn'));
            diagnostic.querySelectorAll('.c13-diagnosis-result').forEach(x=>x.remove());
            result.classList.add('c13-diagnosis-result');diagnostic.append(result);
            status('단계별 로컬 진단 완료 · 새 모델 호출 없음');
          }));
          details.append(diagnostic);
        }

      	box.append(details);
      }
      if (searchResult.narrativeMatches?.length) {
        box.append(el('h3','관련 챕터·아크 목차'));
        box.append(el('p','상위 목차는 과거 이야기의 길잡이일 뿐, 정확한 사실은 아래 연결된 상세 기억으로 확인해야 합니다.', 'small'));
        for(const match of searchResult.narrativeMatches){
          const item=el('details','','search-result');
          item.append(el('summary',`${match.kind==='arc'?'아크':'챕터'} · ${match.title} · ${match.range.startTurn}–${match.range.endTurn}턴`));
          item.append(el('p',match.summary,'small'));
          item.append(el('p','아래 버튼을 누르면 해당 원본 기록으로 이동해.','small'));
          for(const ref of match.childRefs){
            item.append(button(`하위 기록 열기: ${ref.id}`,async()=>{
              const target=entryElements.get(ref.id);if(!target)throw new Error('연결된 기억을 현재 화면에서 찾을 수 없습니다.');
              target.open=true;target.scrollIntoView?.({behavior:'smooth',block:'center'});
            }));
          }
          box.append(item);
        }
      }
      if (!searchResult.results.length) box.append(el('p','직접 일치하는 상세 기억이 없습니다. 위의 서사 목차를 확인하거나 단서를 더 구체적으로 입력해 보세요.', 'small'));
    }
    if (previewResult) {
      const title=el('h3','미리보기 결과'); box.append(title);
      box.append(el('p',`포함 ${previewResult.includedIds.length}개 · ${previewResult.previewCharacters}자 · 추정 ${previewResult.estimatedTokens}토큰(정확하지 않음) · 중복 문장 ${previewResult.skippedIdenticalSentences}개 생략${previewResult.truncatedByBudget?' · 길이 제한으로 일부 제외':''}`, 'small'));
      const t=el('textarea','', 'search-preview'); t.readOnly=true; t.value=previewResult.previewText; box.append(t);
      box.append(el('p','이 미리보기 자체는 RP 프롬프트를 변경하지 않습니다. 자동 회상은 방별 ON에서 생성 시 별도로 수행되며 태그는 사실 본문으로 전달하지 않습니다.', 'tag-warn'));
    }
  }
  async function performRawSearch() {
    if (!activeRoom || !searchQuery.trim()) throw new Error('원문 검색어를 입력해 주세요.');
    rawResult=await rpc('POST',roomUrl('/raw-search'),{query:searchQuery,recentText:recentContext,limit:10});
    renderSearch();
    status(`현재 RP 원문에서 ${rawResult.results.length}개의 후보를 찾았습니다. 추가 모델 호출 없음.`);
  }
  async function performSearch() {
    if (!activeRoom || !searchQuery.trim()) throw new Error('검색어를 입력해 주세요.');
    searchResult=await rpc('POST',roomUrl('/search'),{query:searchQuery,recentText:recentContext,includeChanged,limit:10});
    previewResult=null; renderSearch();
    status(`현재 방에서 ${searchResult.results.length}개의 기억을 찾았습니다. (${searchResult.retrievalMode||'어휘 검색'} · 외부 모델 호출 ${searchResult.modelCalls||0}회)`);
  }
  async function performPreview() {
    if (!activeRoom || !searchQuery.trim()) throw new Error('검색어를 입력해 주세요.');
    previewResult=await rpc('POST',roomUrl('/preview'),{query:searchQuery,recentText:recentContext,includeChanged,limit:10,maxCharacters:6000});
    searchResult=previewResult;renderSearch();
    status('화면 미리보기를 생성했습니다. 실제 RP 자동 주입 여부는 이 방의 설정에 따릅니다.');
  }
  const refreshActive = () => { if (!busy) void run(refresh); };
  const offs = [];
  const offActive = tab.onActivate(refreshActive); if (typeof offActive === 'function') offs.push(offActive);
  try { const off = ctx.state?.subscribe?.('chat.active', refreshActive); if (typeof off === 'function') offs.push(off); } catch {}
  void run(refresh);
  return () => {
    disposed = true;
    for (const p of requests.values()) { clearTimeout(p.timer); p.reject(new Error('확장이 종료됨')); }
    requests.clear();
    onBackend?.(); offs.forEach(off => { try { off(); } catch {} }); tab.destroy();
  };
}
