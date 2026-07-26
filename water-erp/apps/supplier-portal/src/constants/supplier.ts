// U-5/X-3：企业信息共享常量，Register/Dashboard/CompanyInfo 共用，避免表单字段重复维护
export const ENTERPRISE_TYPES = [
  '有限责任公司', '股份有限公司', '国有企业', '集体企业',
  '合伙企业', '个人独资企业', '外商投资企业',
  '民营企业', '个体工商户', '合资企业', '外资企业',
  '其他',
] as const

export const QUAL_TYPE_OPTIONS = [
  '营业执照', '资质证书', '安全生产许可证',
  '质量管理体系认证', '环境管理体系认证',
  '职业健康安全管理体系认证', '信用评级',
  '其他',
] as const
