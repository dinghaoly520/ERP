import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../../common/validators/password-strength';

// 临时供应商注册：凭邀请码 + 极简字段。登录用户名强制为机构代码。
export class RegisterTemporarySupplierDto {
  @IsString() @IsNotEmpty() @MaxLength(20)
  invitationCode: string;

  /** 归属公司名称（62 家名单选择；companyId 未命中/缺省时按此名称自动建档——resolveSupplierCompany） */
  @IsOptional() @IsString() @MaxLength(128)
  companyName?: string;
  /** 归属公司主数据 id：可选（2026-10-14 修复）。注册页 62 家名单多数不在既有主数据，
   *  前端 find 不到 id 传 undefined——此前 @IsNotEmpty 必填导致这类选择 400「归属公司为必选项」
   *  （用户实测临时注册提交报错的根因）。归属解析与建档兜底在 service 层，两者全缺才 400。 */
  @IsOptional() @IsString() @MaxLength(64)
  companyId?: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string; // 企业名称

  /** 机构代码 = 统一社会信用代码（同义字段，冗余存储；登录用户名强制取 creditCode） */
  @IsString() @IsOptional() @MaxLength(20)
  organizationCode?: string;

  @IsString() @IsNotEmpty() @Matches(/^[0-9A-Z]{18}$/, { message: '统一社会信用代码须为 18 位数字与大写字母' })
  creditCode: string;

  /** 法定代表人（临时注册必要信息） */
  @IsString() @IsNotEmpty({ message: '法定代表人为必填' }) @MaxLength(50)
  legalPerson: string;

  @IsString() @IsNotEmpty() @Matches(/^\d{17}[\dXx]$/, { message: '法定代表人身份证号须为 18 位' })
  legalPersonIdCard: string;

  @IsString() @IsOptional() @MaxLength(200)
  registeredAddress?: string;

  @IsString() @IsOptional() @MaxLength(100)
  region?: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  displayName: string; // 联系人姓名

  @IsString() @IsNotEmpty() @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @IsString() @IsNotEmpty() @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;

  /** 短信验证码（发送至 phone；注册前一次性消费） */
  @IsString() @IsNotEmpty() @Matches(/^\d{6}$/, { message: '验证码须为 6 位数字' })
  registrationCode: string;

  @IsEmail() @IsOptional()
  email?: string; // 联系人邮箱

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(20, { each: true })
  tags: string[];
}
