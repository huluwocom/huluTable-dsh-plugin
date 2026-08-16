/**
 * Preset table templates: the blank-table factory plus six presets. Each
 * template ships bilingual (zh/en) names, column headers, options and demo
 * rows; the active language picks one set at creation time, so later template
 * edits never touch existing tables. Sample rows give first-time users
 * something to explore (dropdown colors, kanban lanes, chart views) without
 * any setup — rows align exactly with the column list (no stray cells).
 */
import {
  DEFAULT_COLUMN_WIDTH, newId, type CellValue, type Column, type Row, type TableDoc, type View,
} from './types.ts'

/** Template-side view: group/calendar columns referenced by NAME, resolved at creation. */
export interface TemplateView extends Omit<View, 'id' | 'groupColumnId' | 'calendarColumnId' | 'chart'> {
  /** kanban: name of the select column grouping lanes by option. */
  groupColumnName?: string
  /** calendar: name of the date/datetime column placing events. */
  calendarColumnName?: string
  /** chart: rendering configuration (column names resolved at creation). */
  chart?: (Omit<NonNullable<View['chart']>, 'xColumnId' | 'yColumnIds'> & { xColumnName?: string; yColumnNames?: string[] }) | undefined
}

/** One localized template surface. */
export interface LocalizedTemplate {
  name: string
  description: string
  columns: Column[]
  rows: CellValue[][]
}

export interface TableTemplate {
  id: string
  icon: string
  /** Shared view bindings (names resolve against the localized columns). */
  views?: TemplateView[]
  /** English-localized view list (names + column bindings); falls back to `views`. */
  viewsEn?: TemplateView[]
  zh: LocalizedTemplate
  en: LocalizedTemplate
}

const option = (label: string, color = ''): { id: string; label: string; color: string } => ({ id: newId(), label, color })

const text = (name: string, extra: Partial<Column> = {}): Column => ({
  id: newId(), name, type: 'text', width: DEFAULT_COLUMN_WIDTH, frozen: false, hidden: false, required: false, ...extra,
})

/** Build a localized column list from name/type/option triples. */
function colSpec(
  specs: {
    name: string
    type?: Column['type']
    width?: number
    frozen?: boolean
    required?: boolean
    options?: { label: string; color?: string }[]
    validation?: Column['validation']
    description?: string
  }[],
): Column[] {
  return specs.map(s => text(s.name, {
    ...(s.type !== undefined ? { type: s.type } : {}),
    ...(s.width !== undefined ? { width: s.width } : {}),
    ...(s.frozen !== undefined ? { frozen: s.frozen } : {}),
    ...(s.required !== undefined ? { required: s.required } : {}),
    ...(s.validation !== undefined ? { validation: s.validation } : {}),
    ...(s.description !== undefined ? { description: s.description } : {}),
    ...(s.options !== undefined ? { options: s.options.map(o => option(o.label, o.color)) } : {}),
  }))
}

/** Create a fresh blank table document. */
export function createBlankTable(name: string, lang = 'zh'): TableDoc {
  const now = Date.now()
  return {
    id: newId(),
    name,
    tags: [],
    starred: false,
    createdAt: now,
    updatedAt: now,
    columns: [],
    rows: [],
    views: [{ id: newId(), name: lang === 'en' ? 'Grid' : '网格', kind: 'grid', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [] }],
    goals: [],
    formatRules: [],
    comments: {},
  }
}

/** Apply one template into a new table document (localized surface). */
export function createTableFromTemplate(
  template: TableTemplate,
  name: string,
  localized: LocalizedTemplate,
  lang = 'zh',
): TableDoc {
  const doc = createBlankTable(name, lang)
  const views = lang === 'en' ? template.viewsEn ?? template.views : template.views
  doc.templateId = template.id
  doc.columns = structuredClone(localized.columns)
  doc.rows = localized.rows.map((values) => {
    const cells: Row['cells'] = {}
    doc.columns.forEach((column, i) => {
      const value = values[i]
      if (value !== undefined && value !== '') cells[column.id] = { value }
    })
    return { id: newId(), cells, createdAt: Date.now(), updatedAt: Date.now() }
  })
  if (views !== undefined) {
    doc.views = views.map((v) => {
      const view: View = {
        id: newId(), name: v.name, kind: v.kind, filters: structuredClone(v.filters),
        filterMode: v.filterMode, sorts: structuredClone(v.sorts), hiddenColumns: [...v.hiddenColumns],
      }
      if (v.groupColumnName !== undefined) {
        const group = doc.columns.find(c => c.name === v.groupColumnName)
        if (group !== undefined) view.groupColumnId = group.id
      }
      if (v.calendarColumnName !== undefined) {
        const calendar = doc.columns.find(c => c.name === v.calendarColumnName)
        if (calendar !== undefined) view.calendarColumnId = calendar.id
      }
      const chartSpec = v.chart
      if (chartSpec !== undefined) {
        const x = chartSpec.xColumnName === undefined ? undefined : doc.columns.find(c => c.name === chartSpec.xColumnName)
        const ys = (chartSpec.yColumnNames ?? [])
          .map(n => doc.columns.find(c => c.name === n))
          .filter((c): c is Column => c !== undefined)
          .map(c => c.id)
        if (x !== undefined && ys.length > 0) {
          view.chart = {
            type: chartSpec.type,
            title: chartSpec.title,
            xColumnId: x.id,
            yColumnIds: ys,
          }
        }
      }
      return view
    })
  }
  return doc
}

/** Shared option palettes. */
const STATUS_OPTIONS = [
  { label: '新线索', color: '#93c5fd' },
  { label: '已联系', color: '#fcd34d' },
  { label: '已预约', color: '#fb923c' },
  { label: '已报价', color: '#f472b6' },
  { label: '已成交', color: '#4ade80' },
  { label: '已流失', color: '#cbd5e1' },
]
const STATUS_OPTIONS_EN = [
  { label: 'New lead', color: '#93c5fd' },
  { label: 'Contacted', color: '#fcd34d' },
  { label: 'Appointment', color: '#fb923c' },
  { label: 'Quoted', color: '#f472b6' },
  { label: 'Won', color: '#4ade80' },
  { label: 'Lost', color: '#cbd5e1' },
]
const SOURCE_OPTIONS = [
  { label: '朋友介绍', color: '#dbeafe' },
  { label: '朋友圈', color: '#dcfce7' },
  { label: '抖音', color: '#fef3c7' },
  { label: '小红书', color: '#fce7f3' },
  { label: '线下活动', color: '#e0e7ff' },
  { label: '老客推荐', color: '#ccfbf1' },
]
const SOURCE_OPTIONS_EN = [
  { label: 'Referral', color: '#dbeafe' },
  { label: 'Moments', color: '#dcfce7' },
  { label: 'TikTok', color: '#fef3c7' },
  { label: 'Xiaohongshu', color: '#fce7f3' },
  { label: 'Event', color: '#e0e7ff' },
  { label: 'Returning', color: '#ccfbf1' },
]

/** 客户管理（个人客户）：联系人跟进 + 来源归类 + 状态看板 + 联系日历 + 来源图表。 */
export const crmTemplate: TableTemplate = {
  id: 'crm',
  icon: 'crm',
  views: [
    { name: '全部客户', kind: 'grid', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [] },
    {
      name: '状态看板', kind: 'kanban', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      groupColumnName: '跟进状态',
    },
    {
      name: '联系日历', kind: 'calendar', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      calendarColumnName: '下次联系日期',
    },
    {
      name: '来源分布', kind: 'chart', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      chart: { type: 'pie', title: '', xColumnName: '客户来源', yColumnNames: ['预算'] },
    },
  ],
  viewsEn: [
    { name: 'All customers', kind: 'grid', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [] },
    {
      name: 'Status board', kind: 'kanban', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      groupColumnName: 'Status',
    },
    {
      name: 'Contact calendar', kind: 'calendar', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      calendarColumnName: 'Next contact',
    },
    {
      name: 'Source mix', kind: 'chart', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [],
      chart: { type: 'pie', title: '', xColumnName: 'Source', yColumnNames: ['Budget'] },
    },
  ],
  zh: {
    name: '客户管理',
    description: '个人客户跟进：线索、预约、报价到成交，配看板/日历/图表演示',
    columns: colSpec([
      { name: '姓名', frozen: true, required: true },
      { name: '性别', type: 'select', options: [{ label: '男' }, { label: '女' }] },
      { name: '年龄', type: 'number' },
      { name: '电话', type: 'phone', validation: { kind: 'phone' } },
      { name: '意向产品', type: 'select', options: [{ label: '基础版' }, { label: '进阶版' }, { label: '旗舰版' }] },
      { name: '预算', type: 'currency', width: 120 },
      { name: '客户来源', type: 'select', options: SOURCE_OPTIONS, width: 120, description: '客户从哪里了解到我们' },
      { name: '跟进状态', type: 'select', options: STATUS_OPTIONS, width: 110 },
      { name: '意向评分', type: 'rating', width: 110 },
      { name: '下次联系日期', type: 'date', width: 180 },
      { name: '备注', type: 'textarea', width: 200 },
    ]),
    rows: [
      ['陈小雨', '女', 29, '13812345678', '进阶版', 12000, '朋友介绍', '已成交', 5, '2025-08-15', '偏好周末上门演示'],
      ['李浩然', '男', 34, '13998765432', '旗舰版', 30000, '抖音', '已报价', 4, '2025-08-18', '关注数据迁移方案'],
      ['王思琪', '女', 26, '13755556666', '基础版', 5000, '小红书', '已预约', 3, '2025-08-20', '预约周四下午演示'],
      ['赵子轩', '男', 41, '13644443333', '进阶版', 15000, '朋友介绍', '已联系', 3, '2025-08-22', '预算需向家人确认'],
      ['刘雅婷', '女', 32, '13522221111', '旗舰版', 25000, '朋友圈', '新线索', 2, '2025-08-25', ''],
      ['孙一鸣', '男', 23, '13388889999', '基础版', 3000, '抖音', '已流失', 1, '', '预算不足，暂缓'],
    ],
  },
  en: {
    name: 'Customer CRM',
    description: 'Personal-customer pipeline: leads, appointments, quotes and wins with kanban/calendar/chart demos',
    columns: colSpec([
      { name: 'Name', frozen: true, required: true },
      { name: 'Gender', type: 'select', options: [{ label: 'Male' }, { label: 'Female' }] },
      { name: 'Age', type: 'number' },
      { name: 'Phone', type: 'phone', validation: { kind: 'phone' } },
      { name: 'Product', type: 'select', options: [{ label: 'Basic' }, { label: 'Pro' }, { label: 'Flagship' }] },
      { name: 'Budget', type: 'currency', width: 120 },
      { name: 'Source', type: 'select', options: SOURCE_OPTIONS_EN, width: 130 },
      { name: 'Status', type: 'select', options: STATUS_OPTIONS_EN, width: 120 },
      { name: 'Lead score', type: 'rating', width: 120 },
      { name: 'Next contact', type: 'date', width: 180 },
      { name: 'Notes', type: 'textarea', width: 200 },
    ]),
    rows: [
      ['Emily Chen', 'Female', 29, '13812345678', 'Pro', 12000, 'Referral', 'Won', 5, '2025-08-15', 'Prefers weekend demos'],
      ['Leo Li', 'Male', 34, '13998765432', 'Flagship', 30000, 'TikTok', 'Quoted', 4, '2025-08-18', 'Asks about migration'],
      ['Grace Wang', 'Female', 26, '13755556666', 'Basic', 5000, 'Xiaohongshu', 'Appointment', 3, '2025-08-20', 'Booked Thursday demo'],
      ['Kevin Zhao', 'Male', 41, '13644443333', 'Pro', 15000, 'Referral', 'Contacted', 3, '2025-08-22', 'Budget pending approval'],
      ['Amy Liu', 'Female', 32, '13522221111', 'Flagship', 25000, 'Moments', 'New lead', 2, '2025-08-25', ''],
      ['Sam Sun', 'Male', 23, '13388889999', 'Basic', 3000, 'TikTok', 'Lost', 1, '', 'Budget too low for now'],
    ],
  },
}

/** 项目管理：任务、里程碑、负责人、状态、截止日期。 */
export const projectTemplate: TableTemplate = {
  id: 'project',
  icon: 'project',
  views: [
    { name: '任务列表', kind: 'grid', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [] },
    { name: '状态看板', kind: 'kanban', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [], groupColumnName: '状态' },
  ],
  viewsEn: [
    { name: 'Task list', kind: 'grid', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [] },
    { name: 'Status board', kind: 'kanban', filters: [], filterMode: 'and', sorts: [], hiddenColumns: [], groupColumnName: 'Status' },
  ],
  zh: {
    name: '项目管理',
    description: '任务与里程碑跟踪、负责人、状态与截止日期',
    columns: colSpec([
      { name: '任务名称', frozen: true, required: true },
      { name: '所属项目' },
      { name: '负责人' },
      { name: '优先级', type: 'select', options: [{ label: '低', color: '#e2e8f0' }, { label: '中', color: '#fde68a' }, { label: '高', color: '#fca5a5' }, { label: '紧急', color: '#f87171' }] },
      { name: '状态', type: 'select', options: [{ label: '未开始', color: '#cbd5e1' }, { label: '进行中', color: '#93c5fd' }, { label: '已完成', color: '#4ade80' }, { label: '已暂停', color: '#fcd34d' }] },
      { name: '截止日期', type: 'date' },
      { name: '进度', type: 'progress' },
      { name: '备注', type: 'textarea', width: 200 },
    ]),
    rows: [
      ['完成需求文档', '官网改版', '李婷', '高', '已完成', '2025-07-20', 100, ''],
      ['设计评审', '官网改版', '王芳', '中', '进行中', '2025-08-06', 60, '周三前出评审结论'],
      ['前端开发', '官网改版', '刘洋', '高', '进行中', '2025-08-20', 30, ''],
      ['后端接口联调', '官网改版', '孙杰', '紧急', '未开始', '2025-08-15', 0, '依赖数据库迁移'],
      ['上线发布', '官网改版', '陈磊', '高', '未开始', '2025-08-30', 0, ''],
    ],
  },
  en: {
    name: 'Project Tasks',
    description: 'Task and milestone tracking with owners, status and deadlines',
    columns: colSpec([
      { name: 'Task', frozen: true, required: true },
      { name: 'Project' },
      { name: 'Owner' },
      { name: 'Priority', type: 'select', options: [{ label: 'Low', color: '#e2e8f0' }, { label: 'Medium', color: '#fde68a' }, { label: 'High', color: '#fca5a5' }, { label: 'Urgent', color: '#f87171' }] },
      { name: 'Status', type: 'select', options: [{ label: 'Not started', color: '#cbd5e1' }, { label: 'In progress', color: '#93c5fd' }, { label: 'Done', color: '#4ade80' }, { label: 'Paused', color: '#fcd34d' }] },
      { name: 'Deadline', type: 'date' },
      { name: 'Progress', type: 'progress' },
      { name: 'Notes', type: 'textarea', width: 200 },
    ]),
    rows: [
      ['Write requirements', 'Website revamp', 'Tina', 'High', 'Done', '2025-07-20', 100, ''],
      ['Design review', 'Website revamp', 'Fang', 'Medium', 'In progress', '2025-08-06', 60, 'Review by Wednesday'],
      ['Frontend build', 'Website revamp', 'Yang', 'High', 'In progress', '2025-08-20', 30, ''],
      ['API integration', 'Website revamp', 'Jie', 'Urgent', 'Not started', '2025-08-15', 0, 'Depends on DB migration'],
      ['Launch', 'Website revamp', 'Lei', 'High', 'Not started', '2025-08-30', 0, ''],
    ],
  },
}

/** 财务收支台账：日期、分类、收支、金额、摘要。 */
export const financeTemplate: TableTemplate = {
  id: 'finance',
  icon: 'finance',
  zh: {
    name: '财务收支台账',
    description: '收支明细与分类统计',
    columns: colSpec([
      { name: '日期', type: 'date', required: true },
      { name: '分类', type: 'select', options: [{ label: '销售收入' }, { label: '服务收入' }, { label: '采购成本' }, { label: '办公支出' }, { label: '工资' }, { label: '税费' }, { label: '其他' }] },
      { name: '收支类型', type: 'select', options: [{ label: '收入', color: '#dcfce7' }, { label: '支出', color: '#fee2e2' }] },
      { name: '金额', type: 'currency', required: true },
      { name: '摘要' },
    ]),
    rows: [
      ['2025-08-01', '销售收入', '收入', 85000, 'Q3 第一批回款'],
      ['2025-08-03', '采购成本', '支出', 32000, '服务器采购'],
      ['2025-08-05', '办公支出', '支出', 4500, '办公用品'],
      ['2025-08-08', '服务收入', '收入', 12000, '年度维护费'],
      ['2025-08-10', '工资', '支出', 56000, '8 月工资'],
      ['2025-08-12', '税费', '支出', 9800, '增值税'],
    ],
  },
  en: {
    name: 'Income & Expenses',
    description: 'Daily income and expense ledger with categories',
    columns: colSpec([
      { name: 'Date', type: 'date', required: true },
      { name: 'Category', type: 'select', options: [{ label: 'Sales' }, { label: 'Services' }, { label: 'Procurement' }, { label: 'Office' }, { label: 'Salaries' }, { label: 'Tax' }, { label: 'Other' }] },
      { name: 'Type', type: 'select', options: [{ label: 'Income', color: '#dcfce7' }, { label: 'Expense', color: '#fee2e2' }] },
      { name: 'Amount', type: 'currency', required: true },
      { name: 'Note' },
    ]),
    rows: [
      ['2025-08-01', 'Sales', 'Income', 85000, 'Q3 first batch'],
      ['2025-08-03', 'Procurement', 'Expense', 32000, 'Servers'],
      ['2025-08-05', 'Office', 'Expense', 4500, 'Stationery'],
      ['2025-08-08', 'Services', 'Income', 12000, 'Annual maintenance'],
      ['2025-08-10', 'Salaries', 'Expense', 56000, 'August payroll'],
      ['2025-08-12', 'Tax', 'Expense', 9800, 'VAT'],
    ],
  },
}

/** 员工考勤：日期、员工、出勤类型、备注。 */
export const attendanceTemplate: TableTemplate = {
  id: 'attendance',
  icon: 'attendance',
  zh: {
    name: '员工考勤',
    description: '出勤记录、请假/加班/迟到登记',
    columns: colSpec([
      { name: '日期', type: 'date', required: true },
      { name: '员工姓名', required: true },
      { name: '出勤类型', type: 'select', options: [
        { label: '正常出勤', color: '#dcfce7' }, { label: '请假', color: '#fef3c7' }, { label: '迟到', color: '#fed7aa' },
        { label: '早退', color: '#fed7aa' }, { label: '加班', color: '#dbeafe' }, { label: '出差', color: '#ccfbf1' }, { label: '旷工', color: '#fee2e2' },
      ] },
      { name: '工时', type: 'number' },
      { name: '备注' },
    ]),
    rows: [
      ['2025-08-01', '张伟', '正常出勤', 8, ''],
      ['2025-08-01', '王芳', '请假', 0, '事假一天'],
      ['2025-08-01', '刘洋', '正常出勤', 8, ''],
      ['2025-08-01', '赵敏', '加班', 10, '项目上线'],
      ['2025-08-02', '张伟', '出差', 8, '客户现场'],
    ],
  },
  en: {
    name: 'Attendance',
    description: 'Daily attendance, leave and overtime records',
    columns: colSpec([
      { name: 'Date', type: 'date', required: true },
      { name: 'Employee', required: true },
      { name: 'Type', type: 'select', options: [
        { label: 'Present', color: '#dcfce7' }, { label: 'Leave', color: '#fef3c7' }, { label: 'Late', color: '#fed7aa' },
        { label: 'Early out', color: '#fed7aa' }, { label: 'Overtime', color: '#dbeafe' }, { label: 'Travel', color: '#ccfbf1' }, { label: 'Absent', color: '#fee2e2' },
      ] },
      { name: 'Hours', type: 'number' },
      { name: 'Note' },
    ]),
    rows: [
      ['2025-08-01', 'Wei Zhang', 'Present', 8, ''],
      ['2025-08-01', 'Fang Wang', 'Leave', 0, 'Personal day'],
      ['2025-08-01', 'Yang Liu', 'Present', 8, ''],
      ['2025-08-01', 'Min Zhao', 'Overtime', 10, 'Release night'],
      ['2025-08-02', 'Wei Zhang', 'Travel', 8, 'On-site visit'],
    ],
  },
}

/** 任务待办清单：待办、优先级、截止日期、完成勾选。 */
export const todoTemplate: TableTemplate = {
  id: 'todo',
  icon: 'todo',
  zh: {
    name: '任务待办清单',
    description: '个人/团队待办，勾选即完成',
    columns: colSpec([
      { name: '待办事项', frozen: true, required: true },
      { name: '优先级', type: 'select', options: [{ label: '低', color: '#e2e8f0' }, { label: '中', color: '#fde68a' }, { label: '高', color: '#fca5a5' }] },
      { name: '截止日期', type: 'date' },
      { name: '完成', type: 'checkbox' },
      { name: '备注' },
    ]),
    rows: [
      ['整理周报', '中', '2025-08-08', true, ''],
      ['预约客户会议', '高', '2025-08-07', false, ''],
      ['更新产品文档', '低', '2025-08-15', false, ''],
      ['团队周会', '中', '2025-08-08', false, ''],
    ],
  },
  en: {
    name: 'Todo List',
    description: 'Personal/team todos with one-click completion',
    columns: colSpec([
      { name: 'Task', frozen: true, required: true },
      { name: 'Priority', type: 'select', options: [{ label: 'Low', color: '#e2e8f0' }, { label: 'Medium', color: '#fde68a' }, { label: 'High', color: '#fca5a5' }] },
      { name: 'Due', type: 'date' },
      { name: 'Done', type: 'checkbox' },
      { name: 'Note' },
    ]),
    rows: [
      ['Weekly report', 'Medium', '2025-08-08', true, ''],
      ['Client meeting', 'High', '2025-08-07', false, ''],
      ['Update docs', 'Low', '2025-08-15', false, ''],
      ['Team sync', 'Medium', '2025-08-08', false, ''],
    ],
  },
}

/** 库存管理：商品、分类、入库、出库、库存、预警值。 */
export const inventoryTemplate: TableTemplate = {
  id: 'inventory',
  icon: 'inventory',
  zh: {
    name: '库存管理',
    description: '商品库存、出入库与低库存预警',
    columns: colSpec([
      { name: '商品名称', frozen: true, required: true },
      { name: 'SKU' },
      { name: '分类', type: 'select', options: [{ label: '电子产品' }, { label: '办公用品' }, { label: '耗材' }, { label: '礼品' }] },
      { name: '入库数量', type: 'number' },
      { name: '出库数量', type: 'number' },
      { name: '库存', type: 'number' },
      { name: '预警值', type: 'number' },
      { name: '供应商' },
    ]),
    rows: [
      ['无线鼠标', 'WM-001', '电子产品', 200, 85, 115, 50, '宏远电子'],
      ['机械键盘', 'KB-002', '电子产品', 80, 32, 48, 30, '宏远电子'],
      ['A4 打印纸', 'PP-003', '办公用品', 500, 420, 80, 100, '晨光文具'],
      ['签字笔（盒）', 'PN-004', '办公用品', 300, 260, 40, 50, '晨光文具'],
      ['保温杯（定制）', 'MG-005', '礼品', 150, 60, 90, 20, '嘉礼定制'],
    ],
  },
  en: {
    name: 'Inventory',
    description: 'Stock levels, in/out movements and low-stock alerts',
    columns: colSpec([
      { name: 'Product', frozen: true, required: true },
      { name: 'SKU' },
      { name: 'Category', type: 'select', options: [{ label: 'Electronics' }, { label: 'Office' }, { label: 'Consumables' }, { label: 'Gifts' }] },
      { name: 'In', type: 'number' },
      { name: 'Out', type: 'number' },
      { name: 'Stock', type: 'number' },
      { name: 'Alert at', type: 'number' },
      { name: 'Supplier' },
    ]),
    rows: [
      ['Wireless mouse', 'WM-001', 'Electronics', 200, 85, 115, 50, 'Hongyuan'],
      ['Mechanical keyboard', 'KB-002', 'Electronics', 80, 32, 48, 30, 'Hongyuan'],
      ['A4 paper', 'PP-003', 'Office', 500, 420, 80, 100, 'Chenguang'],
      ['Pens (box)', 'PN-004', 'Office', 300, 260, 40, 50, 'Chenguang'],
      ['Tumbler (custom)', 'MG-005', 'Gifts', 150, 60, 90, 20, 'Jiali'],
    ],
  },
}

/** All selectable templates, in gallery order. */
export const TEMPLATES: readonly TableTemplate[] = [
  crmTemplate, projectTemplate, financeTemplate, attendanceTemplate, todoTemplate, inventoryTemplate,
]

/** Pick the localized surface for a language tag. */
export function localizeTemplate(template: TableTemplate, lang: string): LocalizedTemplate {
  return lang === 'en' ? template.en : template.zh
}
