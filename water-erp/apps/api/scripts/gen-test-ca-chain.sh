#!/usr/bin/env bash
# =================================================================
# 生成 SM2 测试证书链（X.509 真实 DER）— x509 链校验模块单测/e2e 夹具
#
#   root（自签 CA） → intermediate（CA, pathlen:0） → leaf（用户证书）
#   另生成 wrong-root（独立自签 CA）供「根不在信任锚」负例。
#
# 依赖：OpenSSL ≥3.0（SM2 曲线 + -sm3 摘要）。Ubuntu 22.04 自带版本即可。
# 输出：apps/api/test/fixtures/ca-chain/（PEM 全套 + leaf/wrong-leaf DER）
# 幂等：每次重新生成；serial 由 -CAcreateserial 随机化。
# =================================================================
set -euo pipefail
export LC_ALL=C.UTF-8 LANG=C.UTF-8

DIR="$(cd "$(dirname "$0")/.." && pwd)/test/fixtures/ca-chain"
mkdir -p "$DIR"
cd "$DIR"

digest() { openssl dgst -sm3 -r "$1" | awk '{print $1}'; }

# ── 测试根 CA（自签）──
openssl ecparam -name SM2 -genkey -noout -out root.key
openssl req -utf8 -new -x509 -key root.key -out root.pem -days 3650 -sm3 \
  -subj "/C=CN/O=ShuiFa Cloud Test CA/CN=蜀水云采测试根CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# ── 中间 CA（root 签发，pathlen:0）──
openssl ecparam -name SM2 -genkey -noout -out inter.key
openssl req -utf8 -new -key inter.key -subj "/C=CN/O=ShuiFa Cloud Test CA/CN=蜀水云采测试中间CA" -out inter.csr
openssl x509 -req -in inter.csr -CA root.pem -CAkey root.key -CAcreateserial \
  -out inter.pem -days 1825 -sm3 \
  -extfile <(printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign')

# ── 用户证书（inter 签发）──
openssl ecparam -name SM2 -genkey -noout -out leaf.key
openssl req -utf8 -new -key leaf.key -subj "/C=CN/O=蜀水云采测试企业/CN=四川水发建设有限公司" -out leaf.csr
openssl x509 -req -in leaf.csr -CA inter.pem -CAkey inter.key -CAcreateserial \
  -out leaf.pem -days 365 -sm3 \
  -extfile <(printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment')

# ── 错根（独立自签 CA）+ 错链叶子（供 CERT_UNTRUSTED 负例）──
openssl ecparam -name SM2 -genkey -noout -out wrong-root.key
openssl req -utf8 -new -x509 -key wrong-root.key -out wrong-root.pem -days 3650 -sm3 \
  -subj "/C=CN/O=Wrong CA/CN=错误根CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl ecparam -name SM2 -genkey -noout -out wrong-leaf.key
openssl req -utf8 -new -key wrong-leaf.key -subj "/C=CN/O=Wrong Corp/CN=错误链企业" -out wrong-leaf.csr
openssl x509 -req -in wrong-leaf.csr -CA wrong-root.pem -CAkey wrong-root.key -CAcreateserial \
  -out wrong-leaf.pem -days 365 -sm3 -extfile <(printf 'basicConstraints=CA:FALSE')

# ── 过期叶子（负例：notAfter 已过）──
#   openssl 无法直接签发已过期证书，用 -startdate/-enddate 伪造历史窗口：
#   x509 -req 支持 -days 为 0 会报错，改用 faketime？——不引依赖，改为
#   签一个 -days 1 的短期证书，过期用例由单测里对 notBefore/notAfter 做
#   时间窗注入（verifyChain 带 atTime 参数），无需真实过期夹具。

# ── 非 CA 签发者负例：bad-child 由 leaf（CA:FALSE）签发 → 链校验应拒 NOT_CA ──
openssl ecparam -name SM2 -genkey -noout -out bad-child.key
openssl req -utf8 -new -key bad-child.key -subj "/C=CN/O=Bad Chain/CN=非CA签发的证书" -out bad-child.csr
openssl x509 -req -in bad-child.csr -CA leaf.pem -CAkey leaf.key -CAcreateserial \
  -out bad-child.pem -days 365 -sm3 -extfile <(printf 'basicConstraints=CA:FALSE')

# ── DER 版本（全部证书；单测统一读 DER）──
for c in root inter leaf wrong-root wrong-leaf bad-child; do
  openssl x509 -in "$c.pem" -outform DER -out "$c.der"
done

# ── 清理 CSR/srl，只留夹具 ──
rm -f ./*.csr ./*.srl

echo "== 夹具生成完毕 =="
openssl verify -CAfile root.pem inter.pem
openssl verify -CAfile root.pem -untrusted inter.pem leaf.pem
openssl verify -CAfile wrong-root.pem wrong-leaf.pem
echo "root   sm3: $(digest root.pem)"
echo "leaf   sm3: $(digest leaf.pem)"
