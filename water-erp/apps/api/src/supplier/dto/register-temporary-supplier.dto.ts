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

  /** 归属公司（Company 主数据 id，自定义短 id 非 UUID；必选——影响投标归属，账号管理按公司分组，admin 可改） */
  /** 归属公司名称（62 家名单选择；companyId 未命中主数据时按此名称自动建档） */
  @IsOptional() @IsString() @MaxLength(128)
  companyName?: string;
  @IsString() @IsNotEmpty({ message: '归属公司为必选项，须正确选择，否则将影响投标' })
  companyId: string;

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
