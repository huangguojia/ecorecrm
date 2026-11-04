/* ============================================================
   GoodJob 工作台原型 · 外壳与演示数据
   用法：页面里放 <aside class="rail" id="rail"></aside>，
   引入本文件即可自动注入导航。演示数据挂在 window.GJ.data。
   ============================================================ */
(function () {
  const ICONS = {
    dash: '<path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-3H4z"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.4-4.4"/>',
    todo: '<path d="M9 11l2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
    lead: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    deal: '<path d="M4 7h16v12H4z"/><path d="M9 7V5h6v2"/><path d="M4 12h16"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    mail: '<path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/>',
    kb: '<path d="M5 4h9l5 5v11H5z"/><path d="M8 12h8M8 16h5"/>',
    team: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5"/><path d="M17 8a3 3 0 1 1 0 6"/>'
  };
  const NAV = [
    { group: '业务', items: [
      { label: '工作台', icon: 'dash', active: true, tag: '今日' },
      { label: '单据平台', icon: 'doc' },
      { label: '自动获客', icon: 'search', tag: '探索' },
      { label: '线索', icon: 'lead', tag: '管理' },
      { label: '商机', icon: 'deal' }
    ] },
    { group: '协同', items: [
      { label: '即刻沟通', icon: 'chat' },
      { label: '邮件中心', icon: 'mail', tag: '12' },
      { label: '知识协作', icon: 'kb' },
      { label: '团队', icon: 'team' }
    ] }
  ];

  function rail() {
    const el = document.getElementById('rail');
    if (!el) return;
    el.innerHTML = `
      <div class="rail-brand">
        <div class="rail-mark">GJ</div>
        <div class="rail-name">GoodJob<small>GOODJOB CRM</small></div>
      </div>
      ${NAV.map((g) => `
        <div class="rail-group">
          <span>${g.group}</span>
          ${g.items.map((it) => `
            <a class="rail-item${it.active ? ' active' : ''}" href="#">
              <svg viewBox="0 0 24 24">${ICONS[it.icon] || ICONS.dash}</svg>
              <span>${it.label}</span>
              ${it.tag ? `<em>${it.tag}</em>` : ''}
            </a>`).join('')}
        </div>`).join('')}
      <div class="rail-foot">数据每 60 秒刷新<br>最后同步 2026-10-23 01:06</div>`;
  }

  const data = {
    today: '2026.10.23',
    weekday: '周五',
    weather: '宁波 · 多云 19°C',
    kpi: {
      followUp: 12,
      followUpOverdue: 3,
      highRisk: 3,
      highRiskAmount: 86000,
      monthDeal: 412000,
      monthTarget: 600000,
      newLeads: 28,
      replyRate: 63
    },
    funnel: [
      { name: '新线索', count: 156, delta: '+18' },
      { name: '有效线索', count: 88, delta: '+9' },
      { name: '已报价', count: 34, delta: '+4' },
      { name: '谈判中', count: 12, delta: '-1' },
      { name: '本月成交', count: 5, delta: '+2' }
    ],
    queue: [
      { client: 'Nova Metrics GmbH', country: 'DE', initial: 'N', amount: 42000, action: '确认 500 台计价秤的 CE 认证文件', due: '今天 10:30', overdue: true, stage: '谈判中', owner: '陈露' },
      { client: 'Ali Trading LLC', country: 'AE', initial: 'A', amount: 28000, action: '发送 FOB 宁波的修正报价单', due: '今天 14:00', overdue: false, stage: '已报价', owner: '陈露' },
      { client: 'Sakura Scale Co.', country: 'JP', initial: 'S', amount: 16500, action: '回复样品测试视频与交期', due: '逾期 2 天', overdue: true, stage: '跟进中', owner: '王磊' },
      { client: 'Pacific Weigh Pty', country: 'AU', initial: 'P', amount: 61000, action: '安排技术视频会议（对方 3 人）', due: '明天 09:00', overdue: false, stage: '谈判中', owner: '林楠' }
    ],
    risks: [
      { level: 'high', title: 'Nova Metrics 已 9 天未回邮件', note: '商机 $42,000 · 报价后沉默，建议换电话线触达', tag: '沉默风险' },
      { level: 'mid', title: 'USD/CNY 跌破 6.68', note: '未锁汇订单 $86,000，毛利预计 -1.4 个点', tag: '汇率' },
      { level: 'mid', title: 'Sakura 样品签收超 5 天', note: '物流已签收，客户未反馈测试结果', tag: '流程卡点' }
    ],
    rates: [
      { pair: 'USD/CNY', value: '6.6743', delta: '-0.18%', down: true },
      { pair: 'EUR/CNY', value: '7.8142', delta: '+0.06%', down: false },
      { pair: 'GBP/CNY', value: '8.9610', delta: '+0.11%', down: false },
      { pair: 'JPY/CNY', value: '0.0441', delta: '-0.03%', down: true },
      { pair: 'AUD/CNY', value: '4.4318', delta: '+0.09%', down: false }
    ],
    schedule: [
      { time: '10:30', title: 'WhatsApp 通话 · Nova Metrics', who: 'Hans Weber / 采购', kind: 'call', live: true },
      { time: '11:20', title: '内部评审：澳州 61k 报价', who: '林楠 + 财务', kind: 'meeting' },
      { time: '14:00', title: '报价复核 · Ali Trading', who: 'FOB 条款修正', kind: 'task' },
      { time: '16:30', title: '样品发运 · Sakura', who: '顺丰国际 7734 2190', kind: 'ship' }
    ],
    tenders: [
      { org: 'Kenya Medical Supplies Agency', title: '电子台秤及配件年度框架采购', value: 'USD 240k', due: '11-06', fit: 82 },
      { org: 'Queensland TAFE', title: '实验室精密天平 3 年供货协议', value: 'AUD 96k', due: '11-12', fit: 64 }
    ],
    team: [
      { name: '陈露', deals: 3, amount: 128000, rate: 78 },
      { name: '林楠', deals: 2, amount: 96000, rate: 64 },
      { name: '王磊', deals: 2, amount: 74000, rate: 51 },
      { name: '周舟', deals: 1, amount: 38000, rate: 43 }
    ],
    ai: {
      verdict: '今天只做一件事：先把 Nova Metrics 的认证文件补齐并电话确认。',
      basis: '它是本月金额最高的「谈判中」商机（$42,000），已沉默 9 天，且报价有效期 10-25 到期。',
      action: '10:30 通话时确认 CE 文件清单 → 当场发 PDF → 把交期锁到 11-20。',
      impact: '若本周确认，本月成交可达 $454k，完成率从 69% 提到 76%。'
    },
    activity: [
      { t: '09:42', who: '陈露', txt: 'Nova Metrics 打开报价单 3 次（PDF 追踪）' },
      { t: '09:10', who: '系统', txt: 'Ali Trading 回复询盘，标记为高意向' },
      { t: '08:55', who: '林楠', txt: 'Pacific Weigh 新增 1 位参会人（技术总监）' }
    ]
  };

  window.GJ = {
    data,
    rail,
    money(n) { return '$' + (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : n); },
    pct(a, b) { return Math.round((a / b) * 100); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rail);
  else rail();
})();
