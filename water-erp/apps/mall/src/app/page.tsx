'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type PriceStatus = '有效' | '价格波动' | '即将过期' | '待复核';
type PriceSource = '框架协议价' | '历史成交价' | '市场询价' | '人工维护';
type SupplierType = '协议供应商' | '入库供应商' | '市场询价';

interface CatalogItem {
  id: string;
  code: string;
  name: string;
  specification: string;
  category: string;
  group: string;
  unit: string;
  referencePrice: number;
  priceMin: number;
  priceMax: number;
  lastDealPrice: number;
  averagePrice: number;
  supplier: string;
  supplierType: SupplierType;
  priceSource: PriceSource;
  region: string;
  taxIncluded: boolean;
  freightIncluded: boolean;
  updatedAt: string;
  validUntil: string;
  status: PriceStatus;
  changeRate: number;
  minOrder: string;
  remark: string;
}

interface BudgetItem { item: CatalogItem; qty: number; }

const CATALOG_ITEMS: CatalogItem[] = [
  { id: '1', code: 'CGML-GC-STEEL-001', name: 'Q235B 热轧带钢', specification: 'δ=6mm，宽度1250mm', category: '钢材', group: '工程材料', unit: '吨', referencePrice: 4280, priceMin: 4150, priceMax: 4360, lastDealPrice: 4210, averagePrice: 4245, supplier: '攀钢集团成都钢钒有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-01', validUntil: '2026-09-30', status: '有效', changeRate: -2.3, minOrder: '1吨', remark: '适用于输配水工程钢结构、临建及通用工程材料预算参考。' },
  { id: '2', code: 'CGML-GC-CEMENT-002', name: 'P.O42.5 普通硅酸盐水泥', specification: '袋装/散装，强度等级42.5', category: '水泥', group: '工程材料', unit: '吨', referencePrice: 380, priceMin: 365, priceMax: 398, lastDealPrice: 376, averagePrice: 382, supplier: '四川峨胜水泥集团股份有限公司', supplierType: '协议供应商', priceSource: '历史成交价', region: '乐山', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-28', validUntil: '2026-08-31', status: '有效', changeRate: 1.6, minOrder: '5吨', remark: '水利土建及附属工程常用材料，价格受运输半径影响较大。' },
  { id: '3', code: 'CGML-GC-PIPE-003', name: 'HDPE 双壁波纹管', specification: 'DN400，SN8，环刚度≥8kN/㎡', category: '管材', group: '工程材料', unit: '米', referencePrice: 128, priceMin: 118, priceMax: 139, lastDealPrice: 126, averagePrice: 129, supplier: '四川川塑管业有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '德阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-05', validUntil: '2026-07-15', status: '即将过期', changeRate: 3.8, minOrder: '50米', remark: '雨污分流、排水管网项目常用规格，建议采购前复核运距。' },
  { id: '4', code: 'CGML-SB-PUMP-004', name: '潜水排污泵', specification: '15kW，流量100m³/h，扬程18m', category: '水泵', group: '机电设备', unit: '台', referencePrice: 8600, priceMin: 8200, priceMax: 9100, lastDealPrice: 8750, averagePrice: 8680, supplier: '格兰富水泵（上海）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-03', validUntil: '2026-12-31', status: '有效', changeRate: -0.8, minOrder: '1台', remark: '泵站改造、排涝工程常用设备，含标准控制附件。' },
  { id: '5', code: 'CGML-GC-WATERPROOF-005', name: '橡胶止水带', specification: '350×8mm，中埋式', category: '防水材料', group: '工程材料', unit: '米', referencePrice: 35, priceMin: 31, priceMax: 39, lastDealPrice: 34, averagePrice: 35.5, supplier: '衡水恒力工程橡胶有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '泸州', taxIncluded: true, freightIncluded: false, updatedAt: '2026-04-18', validUntil: '2026-06-30', status: '即将过期', changeRate: 0.4, minOrder: '20米', remark: '水工建筑物伸缩缝、施工缝防水材料。' },
  { id: '6', code: 'CGML-XX-METER-006', name: '电磁流量计', specification: 'DN200，4-20mA + RS485，IP68', category: '仪器仪表', group: '信息化设备', unit: '台', referencePrice: 12500, priceMin: 11600, priceMax: 13800, lastDealPrice: 12900, averagePrice: 12180, supplier: '上海威尔泰工业自动化股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-07', validUntil: '2026-10-31', status: '价格波动', changeRate: 8.5, minOrder: '1台', remark: '智慧水务、计量监测项目高频采购设备，近期芯片模块价格上涨。' },
  { id: '7', code: 'CGML-GC-GEO-007', name: '短纤针刺土工布', specification: '200g/㎡，幅宽4m', category: '土工材料', group: '工程材料', unit: '㎡', referencePrice: 3.8, priceMin: 3.55, priceMax: 4.2, lastDealPrice: 3.75, averagePrice: 3.82, supplier: '山东宏祥新材料股份有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '宜宾', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-20', validUntil: '2026-09-20', status: '有效', changeRate: -1.1, minOrder: '200㎡', remark: '堤防、渠道、防渗工程常用材料。' },
  { id: '8', code: 'CGML-TY-LABOR-008', name: '安全防护用品套装', specification: '安全帽/反光背心/护目镜/手套', category: '劳保用品', group: '劳保及通用物资', unit: '套', referencePrice: 260, priceMin: 238, priceMax: 286, lastDealPrice: 252, averagePrice: 258, supplier: '霍尼韦尔安全防护设备有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-02', validUntil: '2026-12-31', status: '有效', changeRate: 0, minOrder: '10套', remark: '集团通用劳保用品，适用于施工现场人员基础配置。' },
  { id: '9', code: 'CGML-SB-GEN-009', name: '柴油发电机组', specification: '200kW，静音箱式，国三排放', category: '发电机组', group: '机电设备', unit: '台', referencePrice: 68000, priceMin: 64500, priceMax: 72500, lastDealPrice: 67200, averagePrice: 66150, supplier: '康明斯动力技术有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '绵阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-16', validUntil: '2026-06-20', status: '待复核', changeRate: 6.2, minOrder: '1台', remark: '应急供电设备，建议采购前组织二次询价。' },
  { id: '10', code: 'CGML-GC-VALVE-010', name: '软密封蝶阀', specification: 'DN300，PN1.0，法兰连接', category: '阀门', group: '机电设备', unit: '台', referencePrice: 2450, priceMin: 2260, priceMax: 2680, lastDealPrice: 2410, averagePrice: 2475, supplier: '天津塘沽瓦特斯阀门有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-04', validUntil: '2026-11-30', status: '有效', changeRate: -1.7, minOrder: '1台', remark: '输配水管线、泵站工程通用阀门。' },
  { id: '11', code: 'CGML-SB-ELEC-011', name: '变频控制柜', specification: '30kW，含变频器、软启及保护模块', category: '电气设备', group: '机电设备', unit: '台', referencePrice: 15800, priceMin: 14900, priceMax: 16980, lastDealPrice: 16200, averagePrice: 15660, supplier: '西门子电气传动有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-30', validUntil: '2026-10-31', status: '价格波动', changeRate: 7.1, minOrder: '1台', remark: '泵站自动化改造设备，近期电子元件价格存在波动。' },
  { id: '12', code: 'CGML-GC-CABLE-012', name: '电力电缆', specification: 'YJV 0.6/1kV 3×150+1×70', category: '电气设备', group: '机电设备', unit: '米', referencePrice: 520, priceMin: 498, priceMax: 548, lastDealPrice: 514, averagePrice: 523, supplier: '四川蜀龙电缆有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-06', validUntil: '2026-08-31', status: '有效', changeRate: 2.4, minOrder: '50米', remark: '铜价影响明显，预算编制建议预留价格浮动空间。' },
  { id: '13', code: 'CGML-GC-STEEL-013', name: 'HRB400E 抗震螺纹钢', specification: 'Φ16-25mm，定尺9m/12m', category: '钢筋', group: '工程材料', unit: '吨', referencePrice: 3920, priceMin: 3810, priceMax: 4080, lastDealPrice: 3890, averagePrice: 3955, supplier: '达州钢铁集团有限责任公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '达州', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-08', validUntil: '2026-09-30', status: '有效', changeRate: -1.9, minOrder: '1吨', remark: '水利工程主体结构及附属构筑物常用钢筋。' },
  { id: '14', code: 'CGML-GC-CONC-014', name: '商品混凝土', specification: 'C30，泵送，坍落度180±30mm', category: '混凝土', group: '工程材料', unit: 'm³', referencePrice: 465, priceMin: 438, priceMax: 492, lastDealPrice: 458, averagePrice: 462, supplier: '成都建工赛利混凝土有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-04', validUntil: '2026-08-31', status: '有效', changeRate: 0.8, minOrder: '20m³', remark: '受供应半径和泵送方式影响较大，预算时需结合项目位置。' },
  { id: '15', code: 'CGML-GC-AGG-015', name: '机制砂', specification: 'Ⅱ区中砂，含泥量≤3%', category: '砂石骨料', group: '工程材料', unit: '吨', referencePrice: 96, priceMin: 88, priceMax: 108, lastDealPrice: 98, averagePrice: 94, supplier: '四川路桥矿业投资开发有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '眉山', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-02', validUntil: '2026-07-20', status: '价格波动', changeRate: 9.2, minOrder: '30吨', remark: '砂石资源价格近期波动明显，建议采购前复核项目周边料源。' },
  { id: '16', code: 'CGML-GC-ADMIX-016', name: '聚羧酸高性能减水剂', specification: '固含量10%，减水率≥25%', category: '外加剂', group: '工程材料', unit: '吨', referencePrice: 2850, priceMin: 2680, priceMax: 3100, lastDealPrice: 2790, averagePrice: 2865, supplier: '四川砼道科技有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-29', validUntil: '2026-09-15', status: '有效', changeRate: -0.6, minOrder: '1吨', remark: '混凝土性能调节材料，需按配合比试验确认掺量。' },
  { id: '17', code: 'CGML-GC-GROUT-017', name: '无收缩灌浆料', specification: 'C60，早强型，袋装25kg', category: '灌浆材料', group: '工程材料', unit: '吨', referencePrice: 1850, priceMin: 1720, priceMax: 1980, lastDealPrice: 1810, averagePrice: 1845, supplier: '四川华西绿舍建材有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-01', validUntil: '2026-08-15', status: '有效', changeRate: 2.1, minOrder: '1吨', remark: '设备基础、二次灌浆和结构补强常用材料。' },
  { id: '18', code: 'CGML-GC-FORM-018', name: '覆膜竹胶板', specification: '1220×2440×15mm，黑膜', category: '模板脚手架', group: '工程材料', unit: '张', referencePrice: 128, priceMin: 116, priceMax: 146, lastDealPrice: 124, averagePrice: 130, supplier: '四川森联木业有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '宜宾', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-23', validUntil: '2026-08-31', status: '有效', changeRate: -3.4, minOrder: '50张', remark: '临建和模板工程常用周转材料。' },
  { id: '19', code: 'CGML-GC-PIPE-019', name: '球墨铸铁管', specification: 'DN600，K9级，T型接口', category: '给排水管材', group: '工程材料', unit: '米', referencePrice: 860, priceMin: 815, priceMax: 928, lastDealPrice: 842, averagePrice: 865, supplier: '新兴铸管股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-03', validUntil: '2026-12-31', status: '有效', changeRate: -1.2, minOrder: '12米', remark: '输配水主干管网常用管材，含胶圈不含特殊管件。' },
  { id: '20', code: 'CGML-GC-PIPE-020', name: 'PE100 给水管', specification: 'DN315，PN1.6MPa，SDR11', category: '给排水管材', group: '工程材料', unit: '米', referencePrice: 238, priceMin: 220, priceMax: 258, lastDealPrice: 232, averagePrice: 240, supplier: '顾地科技股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-06', validUntil: '2026-11-30', status: '有效', changeRate: 1.1, minOrder: '100米', remark: '城乡供水管网、支线管道常用材料。' },
  { id: '21', code: 'CGML-GC-FITTING-021', name: '法兰弯头', specification: 'DN300，PN1.0，90°', category: '管件', group: '工程材料', unit: '个', referencePrice: 680, priceMin: 620, priceMax: 745, lastDealPrice: 665, averagePrice: 672, supplier: '河北圣天管件集团有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-25', validUntil: '2026-08-25', status: '有效', changeRate: 0.9, minOrder: '2个', remark: '管网安装配套管件，需与管材压力等级匹配。' },
  { id: '22', code: 'CGML-SB-VALVE-022', name: '闸阀', specification: 'DN500，PN1.0，明杆软密封', category: '阀门', group: '机电设备', unit: '台', referencePrice: 7600, priceMin: 7180, priceMax: 8250, lastDealPrice: 7480, averagePrice: 7690, supplier: '上海冠龙阀门节能设备股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-05', validUntil: '2026-11-30', status: '有效', changeRate: -0.5, minOrder: '1台', remark: '输水管线和泵站进出水控制阀门。' },
  { id: '23', code: 'CGML-SB-VALVE-023', name: '排气阀', specification: 'DN80，复合式，PN1.6', category: '阀门', group: '机电设备', unit: '台', referencePrice: 1380, priceMin: 1260, priceMax: 1520, lastDealPrice: 1350, averagePrice: 1375, supplier: '株洲南方阀门股份有限公司', supplierType: '协议供应商', priceSource: '历史成交价', region: '德阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-10-31', status: '有效', changeRate: 1.7, minOrder: '1台', remark: '长距离输水管道高点排气装置。' },
  { id: '24', code: 'CGML-SB-PUMP-024', name: '立式离心泵', specification: 'Q=160m³/h，H=45m，37kW', category: '水泵', group: '机电设备', unit: '台', referencePrice: 28600, priceMin: 26800, priceMax: 31500, lastDealPrice: 27900, averagePrice: 28450, supplier: '上海凯泉泵业（集团）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-08', validUntil: '2026-12-31', status: '有效', changeRate: -1.0, minOrder: '1台', remark: '加压泵站、二供系统常用设备。' },
  { id: '25', code: 'CGML-SB-PUMP-025', name: '一体化预制泵站', specification: '筒径3.0m，双泵配置，含控制系统', category: '泵站设备', group: '机电设备', unit: '套', referencePrice: 238000, priceMin: 218000, priceMax: 265000, lastDealPrice: 232000, averagePrice: 241000, supplier: '蓝深集团股份有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '绵阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-18', validUntil: '2026-07-10', status: '待复核', changeRate: 5.8, minOrder: '1套', remark: '市政排水、雨污提升项目成套设备，需结合设计参数复核。' },
  { id: '26', code: 'CGML-SB-TREAT-026', name: '一体化净水设备', specification: '处理量500m³/d，絮凝沉淀过滤', category: '水处理设备', group: '机电设备', unit: '套', referencePrice: 356000, priceMin: 330000, priceMax: 392000, lastDealPrice: 348000, averagePrice: 352000, supplier: '江苏天雨环保集团有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '宜宾', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-30', validUntil: '2026-08-30', status: '价格波动', changeRate: 7.6, minOrder: '1套', remark: '乡镇供水厂改扩建常用成套设备。' },
  { id: '27', code: 'CGML-SB-DOSING-027', name: '自动加药装置', specification: 'PAM/PAC 双箱双泵，PLC控制', category: '加药消毒设备', group: '机电设备', unit: '套', referencePrice: 48200, priceMin: 43800, priceMax: 52800, lastDealPrice: 46900, averagePrice: 47500, supplier: '宜兴市水立方环保设备有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '泸州', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-02', validUntil: '2026-09-30', status: '有效', changeRate: 2.9, minOrder: '1套', remark: '水厂投加系统常用设备，需匹配药剂种类和处理规模。' },
  { id: '28', code: 'CGML-SB-DISINF-028', name: '次氯酸钠发生器', specification: '有效氯1kg/h，盐水电解', category: '加药消毒设备', group: '机电设备', unit: '套', referencePrice: 92000, priceMin: 86500, priceMax: 99800, lastDealPrice: 90500, averagePrice: 91800, supplier: '深圳欧泰华环保技术有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-27', validUntil: '2026-10-31', status: '有效', changeRate: -0.3, minOrder: '1套', remark: '供水厂消毒系统常用设备，含基础安全联锁。' },
  { id: '29', code: 'CGML-XX-SENSOR-029', name: '压力变送器', specification: '0-1.6MPa，4-20mA，精度0.5级', category: '传感器', group: '信息化设备', unit: '只', referencePrice: 620, priceMin: 560, priceMax: 720, lastDealPrice: 598, averagePrice: 615, supplier: '重庆川仪自动化股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-04', validUntil: '2026-12-31', status: '有效', changeRate: -0.9, minOrder: '5只', remark: '泵站、管网监测常用仪表。' },
  { id: '30', code: 'CGML-XX-SENSOR-030', name: '投入式液位计', specification: '0-10m，RS485，防雷型', category: '传感器', group: '信息化设备', unit: '只', referencePrice: 980, priceMin: 890, priceMax: 1120, lastDealPrice: 945, averagePrice: 970, supplier: '麦克传感器股份有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-09-30', status: '有效', changeRate: 1.4, minOrder: '2只', remark: '水池、水库、闸站液位采集常用设备。' },
  { id: '31', code: 'CGML-XX-RTU-031', name: '水利遥测终端 RTU', specification: '4G/北斗双通道，太阳能供电', category: '自动化设备', group: '信息化设备', unit: '套', referencePrice: 13800, priceMin: 12600, priceMax: 15600, lastDealPrice: 13200, averagePrice: 13650, supplier: '北京慧图科技股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-06', validUntil: '2026-11-30', status: '价格波动', changeRate: 6.9, minOrder: '1套', remark: '水文、水资源及管网远程监测站点常用终端。' },
  { id: '32', code: 'CGML-XX-CAMERA-032', name: 'AI 球型摄像机', specification: '400万像素，星光级，30倍变焦', category: '安防监控', group: '信息化设备', unit: '台', referencePrice: 3650, priceMin: 3380, priceMax: 4100, lastDealPrice: 3580, averagePrice: 3620, supplier: '杭州海康威视数字技术股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-07', validUntil: '2026-12-31', status: '有效', changeRate: -2.0, minOrder: '1台', remark: '水厂、泵站、施工现场视频监控常用设备。' },
  { id: '33', code: 'CGML-XX-NET-033', name: '工业级交换机', specification: '8电口+2光口，导轨式，宽温', category: '网络通信', group: '信息化设备', unit: '台', referencePrice: 1450, priceMin: 1320, priceMax: 1680, lastDealPrice: 1410, averagePrice: 1465, supplier: '新华三技术有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-31', validUntil: '2026-09-30', status: '有效', changeRate: 0.6, minOrder: '1台', remark: '自动化控制柜、监测站点网络通信基础设备。' },
  { id: '34', code: 'CGML-XX-SOFT-034', name: '组态软件授权', specification: '开发版1000点位，含运行授权', category: '软件系统', group: '信息化设备', unit: '套', referencePrice: 28000, priceMin: 25800, priceMax: 32600, lastDealPrice: 27500, averagePrice: 28200, supplier: '北京亚控科技发展有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-19', validUntil: '2026-07-31', status: '待复核', changeRate: 4.7, minOrder: '1套', remark: '水厂中控系统、泵站监控系统软件授权。' },
  { id: '35', code: 'CGML-TY-OFFICE-035', name: '办公台式电脑', specification: 'i5/16G/512G SSD/23.8英寸显示器', category: '办公设备', group: '办公后勤', unit: '套', referencePrice: 4850, priceMin: 4550, priceMax: 5280, lastDealPrice: 4720, averagePrice: 4860, supplier: '联想（北京）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-05', validUntil: '2026-12-31', status: '有效', changeRate: -3.1, minOrder: '1套', remark: '集团办公电脑标准配置参考。' },
  { id: '36', code: 'CGML-TY-PRINT-036', name: 'A3 黑白多功能一体机', specification: '打印/复印/扫描，自动双面', category: '办公设备', group: '办公后勤', unit: '台', referencePrice: 6800, priceMin: 6300, priceMax: 7600, lastDealPrice: 6650, averagePrice: 6900, supplier: '富士胶片商业创新（中国）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-26', validUntil: '2026-11-30', status: '有效', changeRate: -1.5, minOrder: '1台', remark: '机关及项目部办公打印复印设备。' },
  { id: '37', code: 'CGML-TY-FURN-037', name: '钢制文件柜', specification: '1850×900×400mm，双节对开', category: '办公家具', group: '办公后勤', unit: '组', referencePrice: 820, priceMin: 760, priceMax: 920, lastDealPrice: 795, averagePrice: 815, supplier: '成都永亨家具有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-09-30', status: '有效', changeRate: 0.2, minOrder: '2组', remark: '项目部和机关档案资料存放通用家具。' },
  { id: '38', code: 'CGML-TY-FUEL-038', name: '0# 车用柴油', specification: '国VI，配送到站/到场', category: '油料能源', group: '办公后勤', unit: '升', referencePrice: 7.42, priceMin: 7.28, priceMax: 7.66, lastDealPrice: 7.39, averagePrice: 7.44, supplier: '中国石化销售股份有限公司四川石油分公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-08', validUntil: '2026-06-30', status: '价格波动', changeRate: 6.4, minOrder: '1000升', remark: '施工机械和应急发电油料，按发改委调价周期动态调整。' },
  { id: '39', code: 'CGML-FW-SURVEY-039', name: '工程测量服务', specification: '地形测量1:500，含成果报告', category: '专业服务', group: '服务采购', unit: '项', referencePrice: 18500, priceMin: 15000, priceMax: 26000, lastDealPrice: 17800, averagePrice: 19000, supplier: '四川省川建勘察设计院有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-21', validUntil: '2026-08-31', status: '待复核', changeRate: 3.5, minOrder: '1项', remark: '按测区面积、地形复杂度和成果要求综合计价。' },
  { id: '40', code: 'CGML-FW-TEST-040', name: '第三方检测服务', specification: '原材料/混凝土/管材检测套餐', category: '检测监测服务', group: '服务采购', unit: '批', referencePrice: 9800, priceMin: 7600, priceMax: 13500, lastDealPrice: 9400, averagePrice: 10100, supplier: '四川省建筑工程质量检测中心有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '全省', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-03', validUntil: '2026-09-30', status: '有效', changeRate: 1.9, minOrder: '1批', remark: '工程质量检测服务，实际费用按检测项目清单核算。' },
  { id: '41', code: 'CGML-FW-MAINT-041', name: '泵站设备维保服务', specification: '季度巡检，含常规保养和故障响应', category: '运维服务', group: '服务采购', unit: '站/年', referencePrice: 42000, priceMin: 36000, priceMax: 52000, lastDealPrice: 40500, averagePrice: 43000, supplier: '四川水发机电运维有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-30', validUntil: '2026-12-31', status: '有效', changeRate: 0.0, minOrder: '1站/年', remark: '适用于中小型泵站年度运维服务预算参考。' },
  { id: '42', code: 'CGML-FW-LOG-042', name: '大件设备运输服务', specification: '20吨以内，省内门到门运输', category: '物流运输服务', group: '服务采购', unit: '车次', referencePrice: 6800, priceMin: 5200, priceMax: 8800, lastDealPrice: 6500, averagePrice: 6900, supplier: '四川安吉物流集团有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-02', validUntil: '2026-08-15', status: '价格波动', changeRate: 7.8, minOrder: '1车次', remark: '泵、控制柜、管件等大件设备运输参考价。' },
  { id: '43', code: 'CGML-GC-STEEL-043', name: 'Q355B 中厚钢板', specification: 'δ=12-20mm，定尺切割', category: '钢材', group: '工程材料', unit: '吨', referencePrice: 4520, priceMin: 4380, priceMax: 4690, lastDealPrice: 4460, averagePrice: 4515, supplier: '攀钢集团成都钢钒有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-07', validUntil: '2026-09-30', status: '有效', changeRate: -1.4, minOrder: '1吨', remark: '闸门、钢结构平台、设备基础预埋件常用钢板。' },
  { id: '44', code: 'CGML-GC-STEEL-044', name: '热镀锌角钢', specification: '∠50×5，6m/支', category: '钢材', group: '工程材料', unit: '吨', referencePrice: 4860, priceMin: 4650, priceMax: 5120, lastDealPrice: 4780, averagePrice: 4890, supplier: '成都冶金实验厂有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-30', validUntil: '2026-08-31', status: '有效', changeRate: 0.9, minOrder: '1吨', remark: '支架、爬梯、围栏和小型钢构件预算参考。' },
  { id: '45', code: 'CGML-GC-REBAR-045', name: 'HRB400E 盘螺', specification: 'Φ8-10mm，抗震级', category: '钢筋', group: '工程材料', unit: '吨', referencePrice: 4050, priceMin: 3920, priceMax: 4210, lastDealPrice: 3980, averagePrice: 4065, supplier: '威远钢铁有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-04', validUntil: '2026-09-15', status: '有效', changeRate: -0.8, minOrder: '1吨', remark: '构造钢筋、箍筋和小型构筑物常用材料。' },
  { id: '46', code: 'CGML-GC-CEMENT-046', name: 'P.S.A32.5 矿渣硅酸盐水泥', specification: '散装，强度等级32.5', category: '水泥', group: '工程材料', unit: '吨', referencePrice: 335, priceMin: 318, priceMax: 358, lastDealPrice: 328, averagePrice: 336, supplier: '四川利森建材集团有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '德阳', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-26', validUntil: '2026-08-31', status: '有效', changeRate: 1.2, minOrder: '10吨', remark: '临建、垫层、砌筑和非主体结构工程常用水泥。' },
  { id: '47', code: 'CGML-GC-CONC-047', name: '商品混凝土', specification: 'C20，非泵送，普通碎石', category: '混凝土', group: '工程材料', unit: 'm³', referencePrice: 398, priceMin: 372, priceMax: 426, lastDealPrice: 390, averagePrice: 402, supplier: '成都建工赛利混凝土有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-08-31', status: '有效', changeRate: -0.4, minOrder: '20m³', remark: '垫层、临时道路和附属结构常用混凝土。' },
  { id: '48', code: 'CGML-GC-AGG-048', name: '碎石', specification: '5-31.5mm，连续级配', category: '砂石骨料', group: '工程材料', unit: '吨', referencePrice: 112, priceMin: 98, priceMax: 126, lastDealPrice: 108, averagePrice: 110, supplier: '四川路桥矿业投资开发有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '眉山', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-05', validUntil: '2026-07-20', status: '价格波动', changeRate: 8.1, minOrder: '30吨', remark: '混凝土骨料、道路基层和临时道路常用材料。' },
  { id: '49', code: 'CGML-GC-ADMIX-049', name: '速凝剂', specification: '液体无碱型，掺量6%-8%', category: '外加剂', group: '工程材料', unit: '吨', referencePrice: 3180, priceMin: 2950, priceMax: 3480, lastDealPrice: 3090, averagePrice: 3210, supplier: '四川砼道科技有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-22', validUntil: '2026-08-20', status: '有效', changeRate: 2.8, minOrder: '1吨', remark: '隧洞、边坡喷射混凝土和应急抢险支护材料。' },
  { id: '50', code: 'CGML-GC-GROUT-050', name: '环氧灌浆料', specification: '高强型，双组份', category: '灌浆材料', group: '工程材料', unit: 'kg', referencePrice: 32, priceMin: 28, priceMax: 38, lastDealPrice: 31, averagePrice: 33, supplier: '成都科良建材有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-29', validUntil: '2026-08-31', status: '有效', changeRate: -1.6, minOrder: '100kg', remark: '设备底座、裂缝修补和精密灌浆场景使用。' },
  { id: '51', code: 'CGML-GC-PIPE-051', name: 'PVC-U 排水管', specification: 'DN160，国标加厚', category: '管材', group: '工程材料', unit: '米', referencePrice: 26, priceMin: 22, priceMax: 31, lastDealPrice: 25, averagePrice: 26.8, supplier: '四川川塑管业有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-02', validUntil: '2026-09-30', status: '有效', changeRate: 0.7, minOrder: '100米', remark: '建筑排水、临建排水和小型排水设施常用管材。' },
  { id: '52', code: 'CGML-GC-PIPE-052', name: '钢丝网骨架 PE 复合管', specification: 'DN200，PN1.6MPa', category: '给排水管材', group: '工程材料', unit: '米', referencePrice: 315, priceMin: 292, priceMax: 348, lastDealPrice: 306, averagePrice: 318, supplier: '华创天元实业发展有限责任公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-08', validUntil: '2026-11-30', status: '有效', changeRate: 1.9, minOrder: '60米', remark: '供水压力管道、穿越段和复杂地质段可选管材。' },
  { id: '53', code: 'CGML-GC-FITTING-053', name: 'PE 电熔直接', specification: 'DN315，PN1.6MPa', category: '管件', group: '工程材料', unit: '个', referencePrice: 460, priceMin: 420, priceMax: 520, lastDealPrice: 448, averagePrice: 462, supplier: '顾地科技股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-03', validUntil: '2026-11-30', status: '有效', changeRate: 1.1, minOrder: '5个', remark: 'PE 给水管道热熔、电熔连接配套管件。' },
  { id: '54', code: 'CGML-GC-WATERPROOF-054', name: 'SBS 改性沥青防水卷材', specification: '4mm，聚酯胎，Ⅱ型', category: '防水材料', group: '工程材料', unit: '㎡', referencePrice: 38, priceMin: 34, priceMax: 45, lastDealPrice: 36, averagePrice: 39, supplier: '东方雨虹防水技术股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-27', validUntil: '2026-10-31', status: '有效', changeRate: -2.0, minOrder: '200㎡', remark: '泵房、水厂建筑屋面和地下结构防水参考。' },
  { id: '55', code: 'CGML-GC-GEO-055', name: '复合土工膜', specification: '两布一膜 600g/㎡', category: '土工材料', group: '工程材料', unit: '㎡', referencePrice: 8.6, priceMin: 7.8, priceMax: 9.8, lastDealPrice: 8.4, averagePrice: 8.7, supplier: '山东宏祥新材料股份有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '宜宾', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-01', validUntil: '2026-09-30', status: '有效', changeRate: 0.5, minOrder: '500㎡', remark: '渠道防渗、库区防渗和围堰防渗常用材料。' },
  { id: '56', code: 'CGML-SB-VALVE-056', name: '可调式减压阀', specification: 'DN200，PN1.6，法兰连接', category: '阀门', group: '机电设备', unit: '台', referencePrice: 12800, priceMin: 11600, priceMax: 14500, lastDealPrice: 12300, averagePrice: 12950, supplier: '株洲南方阀门股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-05', validUntil: '2026-11-30', status: '有效', changeRate: -1.8, minOrder: '1台', remark: '分区供水、压力控制和管网调压常用阀门。' },
  { id: '57', code: 'CGML-SB-VALVE-057', name: '电动蝶阀', specification: 'DN400，PN1.0，开关型执行器', category: '阀门', group: '机电设备', unit: '台', referencePrice: 18500, priceMin: 16900, priceMax: 20600, lastDealPrice: 17800, averagePrice: 18650, supplier: '上海冠龙阀门节能设备股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-04', validUntil: '2026-11-30', status: '价格波动', changeRate: 6.6, minOrder: '1台', remark: '泵站自动化、远程启闭和输水干线控制阀门。' },
  { id: '58', code: 'CGML-SB-PUMP-058', name: '卧式双吸离心泵', specification: 'Q=500m³/h，H=35m，90kW', category: '水泵', group: '机电设备', unit: '台', referencePrice: 86500, priceMin: 81500, priceMax: 94800, lastDealPrice: 84200, averagePrice: 87100, supplier: '上海凯泉泵业（集团）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-06', validUntil: '2026-12-31', status: '有效', changeRate: 1.3, minOrder: '1台', remark: '中大型取水泵站、加压泵站主泵设备参考。' },
  { id: '59', code: 'CGML-SB-PUMP-059', name: '潜水轴流泵', specification: 'Q=1200m³/h，H=6m，45kW', category: '水泵', group: '机电设备', unit: '台', referencePrice: 112000, priceMin: 103000, priceMax: 128000, lastDealPrice: 108000, averagePrice: 114500, supplier: '蓝深集团股份有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '泸州', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-28', validUntil: '2026-08-30', status: '待复核', changeRate: 5.1, minOrder: '1台', remark: '排涝泵站、闸站排水和低扬程大流量场景。' },
  { id: '60', code: 'CGML-SB-ELEC-060', name: '低压配电柜', specification: 'GGD，800×600×2200mm', category: '电气设备', group: '机电设备', unit: '面', referencePrice: 18500, priceMin: 16800, priceMax: 21200, lastDealPrice: 17900, averagePrice: 18600, supplier: '四川电器集团股份有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-09-30', status: '有效', changeRate: 2.2, minOrder: '1面', remark: '泵站、水厂和临时配电系统常用低压柜。' },
  { id: '61', code: 'CGML-SB-ELEC-061', name: '箱式变电站', specification: '10/0.4kV，630kVA，欧式箱变', category: '电气设备', group: '机电设备', unit: '座', referencePrice: 168000, priceMin: 152000, priceMax: 190000, lastDealPrice: 162000, averagePrice: 171000, supplier: '特变电工股份有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '绵阳', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-24', validUntil: '2026-07-31', status: '价格波动', changeRate: 8.0, minOrder: '1座', remark: '供水厂、泵站和施工临电较大容量供配电设备。' },
  { id: '62', code: 'CGML-SB-GEN-062', name: '柴油发电机组', specification: '100kW，静音型，自动切换柜', category: '发电机组', group: '机电设备', unit: '台', referencePrice: 38500, priceMin: 35200, priceMax: 42800, lastDealPrice: 37200, averagePrice: 39100, supplier: '康明斯动力技术有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-02', validUntil: '2026-08-15', status: '有效', changeRate: 3.4, minOrder: '1台', remark: '小型泵站、水厂和项目部应急供电。' },
  { id: '63', code: 'CGML-SB-TREAT-063', name: '机械格栅除污机', specification: '渠宽800mm，栅隙10mm', category: '水处理设备', group: '机电设备', unit: '台', referencePrice: 56000, priceMin: 49800, priceMax: 63800, lastDealPrice: 54200, averagePrice: 56800, supplier: '江苏天雨环保集团有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '宜宾', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-28', validUntil: '2026-09-30', status: '有效', changeRate: 1.8, minOrder: '1台', remark: '取水口、污水提升和预处理工艺常用设备。' },
  { id: '64', code: 'CGML-SB-DOSING-064', name: '二氧化氯发生器', specification: '有效氯500g/h，自动投加', category: '加药消毒设备', group: '机电设备', unit: '套', referencePrice: 68000, priceMin: 62000, priceMax: 76000, lastDealPrice: 66200, averagePrice: 67500, supplier: '山东华特环保科技有限公司', supplierType: '入库供应商', priceSource: '市场询价', region: '乐山', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-20', validUntil: '2026-08-20', status: '待复核', changeRate: 4.9, minOrder: '1套', remark: '乡镇供水站、农村饮水工程消毒设备参考。' },
  { id: '65', code: 'CGML-XX-METER-065', name: '超声波水表', specification: 'DN100，NB-IoT，远传型', category: '仪器仪表', group: '信息化设备', unit: '只', referencePrice: 1680, priceMin: 1520, priceMax: 1890, lastDealPrice: 1600, averagePrice: 1695, supplier: '宁波水表（集团）股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-05', validUntil: '2026-12-31', status: '有效', changeRate: -2.4, minOrder: '5只', remark: '管网分区计量、DMA 分区和大用户计量常用设备。' },
  { id: '66', code: 'CGML-XX-METER-066', name: '浊度仪', specification: '0-100NTU，在线式，4-20mA', category: '仪器仪表', group: '信息化设备', unit: '台', referencePrice: 9800, priceMin: 8900, priceMax: 11200, lastDealPrice: 9550, averagePrice: 9900, supplier: '哈希水质分析仪器有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-10-31', status: '有效', changeRate: 1.6, minOrder: '1台', remark: '水厂出水、原水和工艺过程水质监测。' },
  { id: '67', code: 'CGML-XX-SENSOR-067', name: '余氯传感器', specification: '0-5mg/L，在线式，带流通池', category: '传感器', group: '信息化设备', unit: '套', referencePrice: 6200, priceMin: 5600, priceMax: 7200, lastDealPrice: 5980, averagePrice: 6350, supplier: '上海仪电科学仪器股份有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-03', validUntil: '2026-09-30', status: '有效', changeRate: 2.1, minOrder: '1套', remark: '出厂水、管网末梢水消毒余量在线监测。' },
  { id: '68', code: 'CGML-XX-RTU-068', name: 'PLC 控制站', specification: 'S7-1200，含IO模块和触摸屏', category: '自动化设备', group: '信息化设备', unit: '套', referencePrice: 32500, priceMin: 29800, priceMax: 36800, lastDealPrice: 31800, averagePrice: 32900, supplier: '西门子电气传动有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-07', validUntil: '2026-10-31', status: '价格波动', changeRate: 6.3, minOrder: '1套', remark: '泵站、水厂自动化控制系统核心控制设备。' },
  { id: '69', code: 'CGML-XX-CAMERA-069', name: '枪型网络摄像机', specification: '400万像素，红外50m，PoE', category: '安防监控', group: '信息化设备', unit: '台', referencePrice: 680, priceMin: 590, priceMax: 820, lastDealPrice: 650, averagePrice: 690, supplier: '杭州海康威视数字技术股份有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-04', validUntil: '2026-12-31', status: '有效', changeRate: -1.1, minOrder: '2台', remark: '厂站、库房和施工现场固定点位视频监控。' },
  { id: '70', code: 'CGML-XX-NET-070', name: '4G 工业路由器', specification: '双SIM，VPN，宽温导轨式', category: '网络通信', group: '信息化设备', unit: '台', referencePrice: 1280, priceMin: 1120, priceMax: 1480, lastDealPrice: 1240, averagePrice: 1290, supplier: '厦门四信通信科技有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-30', validUntil: '2026-09-30', status: '有效', changeRate: 0.8, minOrder: '1台', remark: '远程泵站、监测站点和临时施工点通信接入。' },
  { id: '71', code: 'CGML-TY-LABOR-071', name: '防汛抢险救生衣', specification: '成人款，浮力≥7.5kg', category: '劳保用品', group: '劳保及通用物资', unit: '件', referencePrice: 86, priceMin: 72, priceMax: 108, lastDealPrice: 82, averagePrice: 88, supplier: '四川际华应急装备有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-01', validUntil: '2026-10-31', status: '有效', changeRate: 1.3, minOrder: '20件', remark: '防汛抢险、水上作业和应急物资储备常用品。' },
  { id: '72', code: 'CGML-TY-LABOR-072', name: '绝缘安全靴', specification: '10kV，防砸防滑', category: '劳保用品', group: '劳保及通用物资', unit: '双', referencePrice: 168, priceMin: 145, priceMax: 196, lastDealPrice: 160, averagePrice: 170, supplier: '霍尼韦尔安全防护设备有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-29', validUntil: '2026-12-31', status: '有效', changeRate: 0.0, minOrder: '10双', remark: '泵站、电气检修和施工现场电工作业防护用品。' },
  { id: '73', code: 'CGML-TY-OFFICE-073', name: '商用笔记本电脑', specification: 'i7/16G/1T SSD/14英寸', category: '办公设备', group: '办公后勤', unit: '台', referencePrice: 6900, priceMin: 6380, priceMax: 7600, lastDealPrice: 6720, averagePrice: 6950, supplier: '联想（北京）有限公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-06', validUntil: '2026-12-31', status: '有效', changeRate: -2.8, minOrder: '1台', remark: '移动办公、项目现场管理和设计审查常用电脑。' },
  { id: '74', code: 'CGML-TY-FURN-074', name: '办公工位桌', specification: '1400×700mm，含活动柜', category: '办公家具', group: '办公后勤', unit: '套', referencePrice: 1280, priceMin: 1080, priceMax: 1560, lastDealPrice: 1220, averagePrice: 1300, supplier: '成都永亨家具有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '成都', taxIncluded: true, freightIncluded: true, updatedAt: '2026-05-25', validUntil: '2026-09-30', status: '有效', changeRate: -0.6, minOrder: '4套', remark: '机关、项目部和临时办公区标准办公家具。' },
  { id: '75', code: 'CGML-TY-FUEL-075', name: '92# 汽油', specification: '国VI，油卡/配送结算', category: '油料能源', group: '办公后勤', unit: '升', referencePrice: 7.86, priceMin: 7.7, priceMax: 8.05, lastDealPrice: 7.82, averagePrice: 7.88, supplier: '中国石油天然气股份有限公司四川销售分公司', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-08', validUntil: '2026-06-30', status: '价格波动', changeRate: 5.9, minOrder: '500升', remark: '公务车辆、巡检车辆和项目现场车辆油料参考。' },
  { id: '76', code: 'CGML-FW-SURVEY-076', name: '勘察钻探服务', specification: '水文地质钻孔，孔深50m以内', category: '专业服务', group: '服务采购', unit: '米', referencePrice: 260, priceMin: 210, priceMax: 360, lastDealPrice: 248, averagePrice: 270, supplier: '四川省川建勘察设计院有限公司', supplierType: '入库供应商', priceSource: '历史成交价', region: '全省', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-27', validUntil: '2026-08-31', status: '待复核', changeRate: 4.2, minOrder: '100米', remark: '水厂、泵站、管线穿越和基础处理前期勘察。' },
  { id: '77', code: 'CGML-FW-TEST-077', name: '水质检测服务', specification: '常规42项，含采样和报告', category: '检测监测服务', group: '服务采购', unit: '次', referencePrice: 3200, priceMin: 2600, priceMax: 4200, lastDealPrice: 2980, averagePrice: 3350, supplier: '四川省生态环境监测总站技术服务中心', supplierType: '入库供应商', priceSource: '市场询价', region: '全省', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-02', validUntil: '2026-09-30', status: '有效', changeRate: 2.7, minOrder: '1次', remark: '供水水质、出厂水和管网水常规检测服务。' },
  { id: '78', code: 'CGML-FW-MAINT-078', name: '仪表校准服务', specification: '流量计/压力表/水质仪表现场校准', category: '运维服务', group: '服务采购', unit: '批', referencePrice: 8800, priceMin: 6500, priceMax: 12000, lastDealPrice: 8200, averagePrice: 9100, supplier: '四川省计量科学研究院', supplierType: '协议供应商', priceSource: '框架协议价', region: '全省', taxIncluded: true, freightIncluded: false, updatedAt: '2026-06-01', validUntil: '2026-12-31', status: '有效', changeRate: 1.5, minOrder: '1批', remark: '计量仪表周期校准和审计计量依据维护。' },
  { id: '79', code: 'CGML-FW-LOG-079', name: '普通货物运输服务', specification: '9.6米厢式货车，省内运输', category: '物流运输服务', group: '服务采购', unit: '车次', referencePrice: 3200, priceMin: 2400, priceMax: 4600, lastDealPrice: 3050, averagePrice: 3300, supplier: '四川安吉物流集团有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '全省', taxIncluded: true, freightIncluded: true, updatedAt: '2026-06-03', validUntil: '2026-08-31', status: '有效', changeRate: 3.0, minOrder: '1车次', remark: '管件、劳保、办公设备等普通物资运输参考。' },
  { id: '80', code: 'CGML-GC-FORM-080', name: '盘扣式脚手架租赁', specification: 'φ48，Q355，含基础配件', category: '模板脚手架', group: '工程材料', unit: '吨·月', referencePrice: 165, priceMin: 135, priceMax: 210, lastDealPrice: 158, averagePrice: 170, supplier: '四川华构建筑设备租赁有限公司', supplierType: '市场询价', priceSource: '市场询价', region: '成都', taxIncluded: true, freightIncluded: false, updatedAt: '2026-05-31', validUntil: '2026-08-31', status: '价格波动', changeRate: 6.8, minOrder: '10吨·月', remark: '水厂构筑物、厂房和高支模工程周转材料租赁参考。' },
];

const DIRECTORY = [
  { group: '全部目录', children: ['全部'] },
  { group: '工程材料', children: ['钢材', '钢筋', '水泥', '混凝土', '砂石骨料', '外加剂', '灌浆材料', '管材', '给排水管材', '管件', '防水材料', '土工材料', '模板脚手架'] },
  { group: '机电设备', children: ['水泵', '泵站设备', '阀门', '水处理设备', '加药消毒设备', '电气设备', '发电机组'] },
  { group: '信息化设备', children: ['仪器仪表', '传感器', '自动化设备', '安防监控', '网络通信', '软件系统'] },
  { group: '劳保及通用物资', children: ['劳保用品'] },
  { group: '办公后勤', children: ['办公设备', '办公家具', '油料能源'] },
  { group: '服务采购', children: ['专业服务', '检测监测服务', '运维服务', '物流运输服务'] },
];

const REGIONS = ['全部', '全省', '成都', '德阳', '绵阳', '乐山', '泸州', '宜宾', '眉山', '达州'];
const STATUSES: Array<'全部' | PriceStatus> = ['全部', '有效', '价格波动', '即将过期', '待复核'];
const SOURCES: Array<'全部' | PriceSource> = ['全部', '框架协议价', '历史成交价', '市场询价', '人工维护'];

const statusStyles: Record<PriceStatus, string> = {
  有效: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  价格波动: 'bg-orange-50 text-orange-700 border-orange-200',
  即将过期: 'bg-amber-50 text-amber-700 border-amber-200',
  待复核: 'bg-slate-100 text-slate-600 border-slate-200',
};

const sourceStyles: Record<PriceSource, string> = {
  框架协议价: 'bg-blue-50 text-blue-700',
  历史成交价: 'bg-cyan-50 text-cyan-700',
  市场询价: 'bg-purple-50 text-purple-700',
  人工维护: 'bg-slate-100 text-slate-600',
};

const formatPrice = (price: number) => `¥${price.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export default function MallPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [region, setRegion] = useState('全部');
  const [status, setStatus] = useState<'全部' | PriceStatus>('全部');
  const [source, setSource] = useState<'全部' | PriceSource>('全部');
  const [budget, setBudget] = useState<BudgetItem[]>([]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username?: string; displayName?: string; role?: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { headers: { 'X-Portal': 'mall' }, credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          router.push('/login');
          return;
        }
        const data = await r.json().catch(() => null);
        setCurrentUser(data?.user || data || null);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  const filtered = useMemo(() => CATALOG_ITEMS.filter(item => {
    const keyword = search.trim();
    const matchSearch = !keyword || [item.code, item.name, item.specification, item.category, item.supplier].some(v => v.includes(keyword));
    const matchCategory = category === '全部' || item.category === category || item.group === category;
    const matchRegion = region === '全部' || item.region === region || item.region === '全省';
    const matchStatus = status === '全部' || item.status === status;
    const matchSource = source === '全部' || item.priceSource === source;
    return matchSearch && matchCategory && matchRegion && matchStatus && matchSource;
  }), [category, region, search, source, status]);

  const stats = useMemo(() => ({
    total: CATALOG_ITEMS.length,
    suppliers: new Set(CATALOG_ITEMS.map(item => item.supplier)).size,
    updated: CATALOG_ITEMS.filter(item => item.updatedAt >= '2026-06-01').length,
    alerts: CATALOG_ITEMS.filter(item => item.status !== '有效').length,
  }), []);

  const focusItems = useMemo(() => CATALOG_ITEMS.filter(item => item.status !== '有效' || Math.abs(item.changeRate) >= 6).slice(0, 4), []);

  const aiRiskSummary = useMemo(() => ({
    safe: CATALOG_ITEMS.filter(item => item.status === '有效' && Math.abs(item.changeRate) < 6).length,
    inquiry: CATALOG_ITEMS.filter(item => item.status === '价格波动' || Math.abs(item.changeRate) >= 6).length,
    expiring: CATALOG_ITEMS.filter(item => item.status === '即将过期').length,
    review: CATALOG_ITEMS.filter(item => item.status === '待复核').length,
  }), []);

  const aiContextItems = useMemo(() => filtered.slice(0, 12).map(item => ({
    code: item.code,
    name: item.name,
    specification: item.specification,
    category: item.category,
    referencePrice: item.referencePrice,
    unit: item.unit,
    priceRange: `${item.priceMin}-${item.priceMax}`,
    averagePrice: item.averagePrice,
    supplier: item.supplier,
    priceSource: item.priceSource,
    region: item.region,
    validUntil: item.validUntil,
    status: item.status,
    changeRate: item.changeRate,
  })), [filtered]);

  const getAiAdvice = (item: CatalogItem) => {
    if (item.status === '待复核') return { title: '暂不建议引用', className: 'bg-red-50 text-red-700 border-red-200' };
    if (item.status === '价格波动' || Math.abs(item.changeRate) >= 6) return { title: '建议二次询价', className: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (item.status === '即将过期') return { title: '核价后使用', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { title: '可预算参考', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  };

  const buildDetailPrompt = (item: CatalogItem) => `请对目录条目「${item.name}」做价格研判：参考价${formatPrice(item.referencePrice)}/${item.unit}，价格区间${formatPrice(item.priceMin)}-${formatPrice(item.priceMax)}，历史均价${formatPrice(item.averagePrice)}，价格变化${item.changeRate}%，来源${item.priceSource}，状态${item.status}，供应商${item.supplier}。请给出结论、风险点和采购建议。`;

  const askAi = async (message = aiQuestion) => {
    const question = message.trim();
    if (!question) {
      toast.error('请输入需要 AI 分析的问题');
      return;
    }
    setAiOpen(true);
    setAiQuestion(question);
    setAiLoading(true);
    setAiAnswer('');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          context: {
            totalItems: CATALOG_ITEMS.length,
            currentFilters: { category, region, status, source, search },
            riskSummary: aiRiskSummary,
            visibleItems: aiContextItems,
            budget: budget.map(row => ({ code: row.item.code, name: row.item.name, qty: row.qty, unit: row.item.unit, referencePrice: row.item.referencePrice })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'AI 调用失败');
      setAiAnswer(data.answer);
    } catch (error) {
      setAiAnswer(error instanceof Error ? error.message : 'AI 调用失败，请稍后重试。');
      toast.error('AI 调用失败');
    } finally {
      setAiLoading(false);
    }
  };

  const addScenarioBudget = (scenario: string) => {
    const scenarioMap: Record<string, string[]> = {
      乡镇供水站改造: ['26', '27', '28', '6', '29', '33', '32', '8'],
      管网更新工程: ['20', '19', '21', '10', '22', '23', '29', '7'],
      泵站设备维保: ['4', '24', '11', '41', '29', '30', '8'],
      智慧水务监测: ['6', '29', '30', '31', '32', '33', '34'],
    };
    scenarioMap[scenario]?.forEach(id => {
      const item = CATALOG_ITEMS.find(row => row.id === id);
      if (item) addToBudget(item);
    });
    toast.success(`AI 已按「${scenario}」生成预算清单建议`);
  };

  const addToBudget = (item: CatalogItem) => {
    setBudget(prev => {
      const idx = prev.findIndex(row => row.item.id === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { item, qty: 1 }];
    });
    toast.success(`已加入预算清单：${item.name}`);
  };

  const changeQty = (id: string, delta: number) => {
    setBudget(prev => prev.map(row => {
      if (row.item.id !== id) return row;
      const qty = row.qty + delta;
      return qty <= 0 ? null : { ...row, qty };
    }).filter(Boolean) as BudgetItem[]);
  };

  const removeBudgetItem = (id: string) => setBudget(prev => prev.filter(row => row.item.id !== id));
  const budgetTotal = budget.reduce((sum, row) => sum + row.item.referencePrice * row.qty, 0);
  const registeredName = currentUser?.displayName?.trim() || '注册名称未设置';
  const userInitial = registeredName.slice(0, 1);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Portal': 'mall' }, credentials: 'include' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#18243a]" style={{ fontFamily: '"Microsoft YaHei","PingFang SC",Arial,sans-serif' }}>
      <header className="sticky top-0 z-50 border-b border-[#dce6f3] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-[1680px] items-center justify-between px-6">
          <a href="http://localhost:3006" className="flex items-center gap-3 no-underline">
            <img src="/assets/logo.jpg" alt="四川水发集团" className="h-11 w-auto object-contain" />
            <span>
              <strong className="block text-xl font-black tracking-[0.12em] text-[#123a6e]" style={{ fontFamily: '"SimHei","黑体",sans-serif' }}>四川水发集团</strong>
            </span>
          </a>

          <div className="flex items-center gap-3">
            <button onClick={() => setBudgetOpen(true)} className="relative h-10 rounded-xl bg-[#064ea2] px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(6,78,162,.2)] transition hover:bg-[#043d82]">预算清单{budget.length > 0 && <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e74c3c] px-1 text-xs text-white">{budget.length}</span>}</button>
            <div className="flex items-center gap-2 rounded-xl bg-[#f3f7fc] px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#064ea2] text-xs font-black text-white">{userInitial}</span>
              <div className="hidden leading-tight sm:block">
                <div className="text-sm font-black text-[#18243a]">{registeredName}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="rounded-xl border border-[#d5e0ef] bg-white px-3 py-2 text-sm font-semibold text-[#5a6d8a] transition hover:border-[#e74c3c] hover:text-[#e74c3c]">退出登录</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 py-6">
        <section className="overflow-hidden rounded-[28px] border border-[#dbe6f3] bg-[#063f86] text-white shadow-[0_24px_70px_rgba(6,78,162,.18)]">
          <div className="relative px-8 py-8 lg:px-10">
            <div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,.24),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(24,165,108,.22),transparent_34%)]" />
            <div className="relative w-full">
              <h1 className="mb-3 text-3xl font-black tracking-wide lg:text-4xl">集中采购目录</h1>
              <p className="max-w-2xl text-sm leading-7 text-white/75">统一展示协议价、历史成交价与市场参考价，辅助预算编制、采购立项和询价比价。</p>
              <div className="relative mt-6 w-full">
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索物资 / 规格 / 编码 / 供应商" className="h-12 w-full rounded-xl border border-white/20 bg-white/95 pl-11 pr-4 text-sm text-[#18243a] outline-none transition placeholder:text-[#8a96aa] focus:border-white focus:bg-white focus:shadow-[0_0_0_4px_rgba(255,255,255,.18)]" />
                <svg className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5a6d8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-white to-[#f4f8ff] p-5 shadow-[0_12px_34px_rgba(6,78,162,.07)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-black text-[#123a6e]">智能采购价格助手</h2>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50 px-3 py-2"><div className="text-lg font-black text-emerald-700">{aiRiskSummary.safe}</div><div className="text-[11px] font-bold text-emerald-700">可参考</div></div>
              <div className="rounded-xl bg-orange-50 px-3 py-2"><div className="text-lg font-black text-orange-700">{aiRiskSummary.inquiry}</div><div className="text-[11px] font-bold text-orange-700">需询价</div></div>
              <div className="rounded-xl bg-amber-50 px-3 py-2"><div className="text-lg font-black text-amber-700">{aiRiskSummary.expiring}</div><div className="text-[11px] font-bold text-amber-700">将过期</div></div>
              <div className="rounded-xl bg-red-50 px-3 py-2"><div className="text-lg font-black text-red-700">{aiRiskSummary.review}</div><div className="text-[11px] font-bold text-red-700">待复核</div></div>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row">
            <input value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} placeholder="问 AI：帮我分析当前筛选结果、生成管网更新预算清单、哪些价格需要复核？" className="h-11 flex-1 rounded-xl border border-[#cdd9ea] bg-white px-4 text-sm outline-none focus:border-[#064ea2]" />
            <button onClick={() => askAi()} disabled={aiLoading} className="h-11 rounded-xl bg-[#064ea2] px-5 text-sm font-black text-white transition hover:bg-[#043d82] disabled:opacity-60">{aiLoading ? 'AI 分析中...' : 'AI 分析'}</button>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            ['目录物资', stats.total.toLocaleString(), '纳入集团集中采购目录'],
            ['协议供应商', stats.suppliers.toLocaleString(), '已入库或框架协议供应商'],
            ['本月更新', stats.updated.toLocaleString(), '近30天维护价格条目'],
            ['价格预警', stats.alerts.toLocaleString(), '波动、过期或待复核条目'],
          ].map(([label, value, desc], idx) => <div key={label} className="rounded-2xl border border-[#e1e9f4] bg-white p-5 shadow-[0_10px_28px_rgba(15,35,65,.05)]"><div className="text-sm font-bold text-[#5a6d8a]">{label}</div><div className={`mt-2 text-3xl font-black ${idx === 3 ? 'text-[#e67e22]' : 'text-[#064ea2]'}`}>{value}</div><div className="mt-1 text-xs text-[#8a96aa]">{desc}</div></div>)}
        </section>

        <section className="mt-5 rounded-2xl border border-[#e1e9f4] bg-white p-4 shadow-[0_10px_28px_rgba(15,35,65,.04)]">
          <div className="grid gap-3 md:grid-cols-4">
            <select value={region} onChange={e => setRegion(e.target.value)} className="h-11 rounded-xl border border-[#cdd9ea] bg-white px-3 text-sm outline-none focus:border-[#064ea2]">{REGIONS.map(v => <option key={v}>{v}</option>)}</select>
            <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="h-11 rounded-xl border border-[#cdd9ea] bg-white px-3 text-sm outline-none focus:border-[#064ea2]">{STATUSES.map(v => <option key={v}>{v}</option>)}</select>
            <select value={source} onChange={e => setSource(e.target.value as typeof source)} className="h-11 rounded-xl border border-[#cdd9ea] bg-white px-3 text-sm outline-none focus:border-[#064ea2]">{SOURCES.map(v => <option key={v}>{v}</option>)}</select>
            <button onClick={() => { setSearch(''); setCategory('全部'); setRegion('全部'); setStatus('全部'); setSource('全部'); }} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#5a6d8a] transition hover:border-[#064ea2] hover:text-[#064ea2]">重置筛选</button>
          </div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-[#e1e9f4] bg-white p-4 shadow-[0_10px_28px_rgba(15,35,65,.04)] lg:sticky lg:top-21 lg:self-start">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-black text-[#18243a]">集中采购目录</h2><span className="rounded-full bg-[#eef3fb] px-2 py-0.5 text-xs font-bold text-[#064ea2]">{filtered.length}项</span></div>
            <div className="space-y-3">{DIRECTORY.map(section => <div key={section.group}><div className="mb-1 text-xs font-bold text-[#8a96aa]">{section.group}</div><div className="grid gap-1">{section.children.map(child => <button key={child} onClick={() => setCategory(child)} className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${category === child ? 'bg-[#064ea2] text-white shadow-[0_8px_18px_rgba(6,78,162,.2)]' : 'text-[#344563] hover:bg-[#f3f7fc] hover:text-[#064ea2]'}`}><span>{child}</span><span className={`text-xs ${category === child ? 'text-white/70' : 'text-[#8a96aa]'}`}>{child === '全部' ? CATALOG_ITEMS.length : CATALOG_ITEMS.filter(item => item.category === child || item.group === child).length}</span></button>)}</div></div>)}</div>
          </aside>

          <div className="min-w-0 space-y-5">
            <section className="grid gap-4 xl:grid-cols-4">{focusItems.map(item => <button key={item.id} onClick={() => setDetail(item)} className="group rounded-2xl border border-[#e1e9f4] bg-white p-4 text-left shadow-[0_10px_28px_rgba(15,35,65,.04)] transition hover:-translate-y-0.5 hover:border-[#064ea2]/30 hover:shadow-[0_18px_42px_rgba(6,78,162,.10)]"><div className="mb-3 flex items-center justify-between gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[item.status]}`}>{item.status}</span><span className={`text-xs font-black ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</span></div><h3 className="line-clamp-1 text-sm font-black text-[#18243a] group-hover:text-[#064ea2]">{item.name}</h3><p className="mt-1 line-clamp-1 text-xs text-[#8a96aa]">{item.specification}</p><div className="mt-3 flex items-end justify-between"><div><span className="text-xl font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></div><span className="text-xs font-semibold text-[#5a6d8a]">{item.validUntil}</span></div></button>)}</section>

            <section className="overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_10px_28px_rgba(15,35,65,.05)]">
              <div className="flex items-center justify-between border-b border-[#e8eef6] px-5 py-4"><div><h2 className="text-lg font-black text-[#18243a]">目录清单</h2><p className="mt-1 text-xs text-[#8a96aa]">参考价用于预算编制与询价比价，最终采购价格以采购文件及成交结果为准。</p></div><button onClick={() => toast.success('价格清单导出功能已预留，接入后端后生成 Excel 文件')} className="hidden rounded-xl border border-[#cdd9ea] px-4 py-2 text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc] md:block">导出价格清单</button></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[1180px] border-collapse text-sm"><thead className="bg-[#f7faff] text-xs font-bold text-[#5a6d8a]"><tr><th className="px-4 py-3 text-left">目录编码 / 物资</th><th className="px-4 py-3 text-left">规格型号</th><th className="px-4 py-3 text-left">分类</th><th className="px-4 py-3 text-right">参考价</th><th className="px-4 py-3 text-left">价格区间</th><th className="px-4 py-3 text-left">供应商</th><th className="px-4 py-3 text-left">来源</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-[#eef3f8]">{filtered.map(item => <tr key={item.id} className="transition hover:bg-[#f8fbff]"><td className="px-4 py-4"><button onClick={() => setDetail(item)} className="text-left"><div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div><div className="mt-1 font-black text-[#18243a] hover:text-[#064ea2]">{item.name}</div></button></td><td className="max-w-[190px] px-4 py-4 text-[#344563]">{item.specification}</td><td className="px-4 py-4"><span className="rounded-full bg-[#eef3fb] px-2 py-1 text-xs font-bold text-[#064ea2]">{item.category}</span></td><td className="px-4 py-4 text-right"><span className="text-base font-black text-[#e74c3c]">{formatPrice(item.referencePrice)}</span><span className="text-xs text-[#8a96aa]">/{item.unit}</span></td><td className="px-4 py-4 text-[#5a6d8a]">{formatPrice(item.priceMin)} - {formatPrice(item.priceMax)}</td><td className="max-w-[180px] px-4 py-4"><div className="truncate font-semibold text-[#18243a]">{item.supplier}</div><div className="mt-1 text-xs text-[#8a96aa]">{item.supplierType} · {item.region}</div></td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-bold ${sourceStyles[item.priceSource]}`}>{item.priceSource}</span></td><td className="px-4 py-4"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusStyles[item.status]}`}>{item.status}</span><div className={`mt-1 text-xs font-bold ${item.changeRate > 0 ? 'text-[#e74c3c]' : item.changeRate < 0 ? 'text-[#18a56c]' : 'text-[#8a96aa]'}`}>{item.changeRate > 0 ? '+' : ''}{item.changeRate}%</div></td><td className="px-4 py-4 text-right"><button onClick={() => setDetail(item)} className="mr-2 text-xs font-bold text-[#064ea2] hover:underline">详情</button><button onClick={() => addToBudget(item)} className="rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#043d82]">加入预算</button></td></tr>)}</tbody></table></div>
              {filtered.length === 0 && <div className="px-6 py-16 text-center"><div className="text-5xl">📋</div><h3 className="mt-3 text-lg font-black text-[#18243a]">未找到匹配的目录条目</h3><p className="mt-1 text-sm text-[#8a96aa]">请调整关键词、分类、区域或价格状态后重试。</p></div>}
            </section>
          </div>
        </section>
      </main>

      {budgetOpen && <div className="fixed inset-0 z-[100] flex justify-end"><div className="absolute inset-0 bg-[#0f1f35]/35 backdrop-blur-sm" onClick={() => setBudgetOpen(false)} /><div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#e5ecf4] px-6 py-4"><div><h2 className="text-lg font-black text-[#18243a]">预算清单</h2><p className="mt-1 text-xs text-[#8a96aa]">用于项目预算、采购立项附件和询价前准备</p><div className="mt-3 flex flex-wrap gap-2">{['乡镇供水站改造', '管网更新工程', '泵站设备维保', '智慧水务监测'].map(scenario => <button key={scenario} onClick={() => addScenarioBudget(scenario)} className="rounded-full bg-[#eef3fb] px-3 py-1 text-xs font-bold text-[#064ea2] hover:bg-[#dfeeff]">AI生成：{scenario}</button>)}</div></div><button onClick={() => setBudgetOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-[#f3f7fc]">✕</button></div>{budget.length > 0 ? <><div className="flex-1 overflow-auto px-6 py-3">{budget.map(({ item, qty }) => <div key={item.id} className="border-b border-[#eef3f8] py-4"><div className="flex justify-between gap-4"><div className="min-w-0"><div className="font-mono text-xs font-bold text-[#064ea2]">{item.code}</div><div className="mt-1 truncate text-sm font-black text-[#18243a]">{item.name}</div><div className="mt-1 text-xs text-[#8a96aa]">{item.specification}</div></div><button onClick={() => removeBudgetItem(item.id)} className="text-sm text-[#c3ccd8] transition hover:text-[#e74c3c]">删除</button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={() => changeQty(item.id, -1)} className="h-7 w-7 rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a]">−</button><span className="w-8 text-center text-sm font-black">{qty}</span><button onClick={() => changeQty(item.id, 1)} className="h-7 w-7 rounded-lg bg-[#f0f3f8] font-bold text-[#5a6d8a]">+</button><span className="text-xs text-[#8a96aa]">{item.unit}</span></div><div className="text-right"><div className="text-xs text-[#8a96aa]">参考小计</div><div className="font-black text-[#e74c3c]">{formatPrice(item.referencePrice * qty)}</div></div></div></div>)}</div><div className="border-t border-[#e5ecf4] px-6 py-4"><div className="mb-4 flex items-center justify-between"><span className="text-sm font-bold text-[#5a6d8a]">预算参考合计</span><span className="text-2xl font-black text-[#e74c3c]">{formatPrice(budgetTotal)}</span></div><div className="grid grid-cols-2 gap-3"><button onClick={() => toast.success('预算清单导出功能已预留，接入后端后生成 Excel 文件')} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">导出预算清单</button><button onClick={() => { toast.success('询价单已生成草稿，可在采购模块继续完善'); setBudgetOpen(false); }} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">生成询价单</button></div></div></> : <div className="flex flex-1 flex-col items-center justify-center text-center"><div className="text-5xl">📑</div><p className="mt-3 text-sm font-bold text-[#8a96aa]">预算清单为空</p><button onClick={() => setBudgetOpen(false)} className="mt-3 text-sm font-bold text-[#064ea2] hover:underline">返回目录选择物资</button></div>}</div></div>}

      {aiOpen && <div className="fixed bottom-6 right-6 z-[120] w-[min(460px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-[#bfd4f4] bg-white shadow-[0_22px_70px_rgba(6,78,162,.22)]"><div className="flex items-center justify-between bg-[#064ea2] px-5 py-4 text-white"><div><div className="text-sm font-black">DeepSeek AI 价格助手</div><div className="text-xs text-white/70">采购价格研判 / 预算建议 / 风险说明</div></div><button onClick={() => setAiOpen(false)} className="rounded-lg px-2 py-1 text-white/80 hover:bg-white/10">✕</button></div><div className="max-h-[420px] overflow-auto p-5"><textarea value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} className="min-h-20 w-full rounded-xl border border-[#cdd9ea] p-3 text-sm outline-none focus:border-[#064ea2]" placeholder="输入你的采购问题..." /><button onClick={() => askAi()} disabled={aiLoading} className="mt-3 h-10 w-full rounded-xl bg-[#064ea2] text-sm font-black text-white disabled:opacity-60">{aiLoading ? 'DeepSeek 分析中...' : '发送给 AI'}</button><div className="mt-4 max-h-[300px] overflow-auto rounded-xl bg-[#f7faff] p-4 text-sm leading-7 text-[#344563]">{aiLoading ? <div className="flex items-center gap-2 text-[#5a6d8a]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#064ea2]" />正在调用 DeepSeek，请稍候...</div> : aiAnswer ? <AiMarkdown content={aiAnswer} /> : <div className="text-[#8a96aa]">可以询问：哪些价格需要复核？帮我生成管网更新预算清单；当前筛选结果有哪些价格风险？</div>}</div></div></div>}

      {detail && <div className="fixed inset-0 z-[110] flex justify-end"><div className="absolute inset-0 bg-[#0f1f35]/35 backdrop-blur-sm" onClick={() => setDetail(null)} /><div className="relative h-full w-full max-w-2xl overflow-auto bg-white shadow-2xl"><div className="border-b border-[#e5ecf4] bg-[#f8fbff] px-6 py-5"><div className="mb-3 flex items-center justify-between"><span className="font-mono text-xs font-black text-[#064ea2]">{detail.code}</span><button onClick={() => setDetail(null)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a96aa] transition hover:bg-white">✕</button></div><h2 className="text-2xl font-black text-[#18243a]">{detail.name}</h2><p className="mt-2 text-sm text-[#5a6d8a]">{detail.specification}</p></div><div className="space-y-5 px-6 py-5"><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">价格信息</div><div className="grid gap-4 sm:grid-cols-2"><Info label="当前参考价" value={`${formatPrice(detail.referencePrice)} / ${detail.unit}`} strong /><Info label="价格区间" value={`${formatPrice(detail.priceMin)} - ${formatPrice(detail.priceMax)}`} /><Info label="最近成交价" value={formatPrice(detail.lastDealPrice)} /><Info label="历史采购均价" value={formatPrice(detail.averagePrice)} /><Info label="价格变化" value={`${detail.changeRate > 0 ? '+' : ''}${detail.changeRate}%`} /><Info label="价格状态" value={detail.status} /></div></div><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">供应商与适用范围</div><div className="grid gap-4 sm:grid-cols-2"><Info label="供应商" value={detail.supplier} /><Info label="供应商类型" value={detail.supplierType} /><Info label="适用区域" value={detail.region} /><Info label="最小参考采购量" value={detail.minOrder} /><Info label="含税" value={detail.taxIncluded ? '是' : '否'} /><Info label="含运费" value={detail.freightIncluded ? '是' : '否'} /></div></div><div className="rounded-2xl border border-[#e1e9f4] p-5"><div className="mb-3 text-sm font-black text-[#18243a]">价格依据</div><div className="grid gap-4 sm:grid-cols-2"><Info label="价格来源" value={detail.priceSource} /><Info label="更新时间" value={detail.updatedAt} /><Info label="有效期至" value={detail.validUntil} /><Info label="分类目录" value={`${detail.group} / ${detail.category}`} /></div><p className="mt-4 rounded-xl bg-[#f7faff] p-3 text-sm leading-6 text-[#5a6d8a]">{detail.remark}</p></div><div className="rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-[#f8fbff] to-white p-5"><div className="mb-3 flex items-center justify-between"><div className="text-sm font-black text-[#123a6e]">AI 价格研判</div><button onClick={() => askAi(buildDetailPrompt(detail))} className="rounded-full bg-[#064ea2] px-3 py-1 text-xs font-black text-white">调用 DeepSeek 分析</button></div><p className="text-sm leading-6 text-[#5a6d8a]">点击分析后，AI 将结合参考价、价格区间、历史均价、供应商、价格来源和有效期，生成风险结论、询价建议和预算引用说明。</p></div><div className="grid grid-cols-2 gap-3"><button onClick={() => { navigator.clipboard?.writeText(detail.code); toast.success('目录编码已复制'); }} className="h-11 rounded-xl border border-[#cdd9ea] text-sm font-bold text-[#064ea2] transition hover:bg-[#f3f7fc]">复制目录编码</button><button onClick={() => { addToBudget(detail); setDetail(null); }} className="h-11 rounded-xl bg-[#064ea2] text-sm font-bold text-white transition hover:bg-[#043d82]">加入预算清单</button></div></div></div></div>}
    </div>
  );
}

function AiMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let tableBuffer: string[] = [];
  let listBuffer: string[] = [];

  const inline = (text: string) => text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[-*]\s+/, '')
    .trim();

  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-3 space-y-1.5 rounded-xl bg-white/70 p-3 text-sm text-[#344563]">
        {listBuffer.map((item, idx) => <li key={idx} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#064ea2]" /><span>{inline(item)}</span></li>)}
      </ul>,
    );
    listBuffer = [];
  };

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      tableBuffer = [];
      return;
    }
    const rows = tableBuffer
      .filter(row => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row))
      .map(row => row.split('|').map(cell => inline(cell)).filter(Boolean));
    const [head, ...body] = rows;
    blocks.push(
      <div key={`table-${blocks.length}`} className="my-4 overflow-x-auto rounded-xl border border-[#dfe8f5] bg-white">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-[#eef5ff] text-[#123a6e]">
            <tr>{head.map((cell, idx) => <th key={idx} className="whitespace-nowrap px-3 py-2 font-black">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#edf2f8]">
            {body.map((row, idx) => <tr key={idx}>{row.map((cell, cellIdx) => <td key={cellIdx} className="max-w-[220px] px-3 py-2 align-top text-[#344563]">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>,
    );
    tableBuffer = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      flushTable();
      return;
    }
    if (trimmed.startsWith('|')) {
      flushList();
      tableBuffer.push(trimmed);
      return;
    }
    flushTable();
    if (/^[-*]\s+/.test(trimmed)) {
      listBuffer.push(trimmed);
      return;
    }
    flushList();
    if (/^#{1,4}\s+/.test(trimmed)) {
      blocks.push(<h3 key={idx} className="mt-4 mb-2 border-l-4 border-[#064ea2] pl-3 text-base font-black text-[#123a6e]">{inline(trimmed.replace(/^#{1,4}\s+/, ''))}</h3>);
      return;
    }
    if (/^---+$/.test(trimmed)) return;
    blocks.push(<p key={idx} className="my-2 text-sm leading-7 text-[#344563]">{inline(trimmed)}</p>);
  });

  flushList();
  flushTable();
  return <div>{blocks}</div>;
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-xs font-bold text-[#8a96aa]">{label}</div><div className={`mt-1 text-sm ${strong ? 'text-xl font-black text-[#e74c3c]' : 'font-semibold text-[#18243a]'}`}>{value}</div></div>;
}
