# 自建 pgbouncer 镜像：公共 registry-mirror（daocloud）对 pgbouncer 系镜像返回 403，
# 且镜像源缓存的官方 latest 是 1.15 老版（env 配置不生效、auth_type=any），故从 alpine 直接装发行版包。
FROM alpine:3.20
RUN apk add --no-cache pgbouncer \
    && mkdir -p /etc/pgbouncer \
    && addgroup -S pgbouncer && adduser -S -G pgbouncer pgbouncer
COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY userlist.txt /etc/pgbouncer/userlist.txt
EXPOSE 6432
USER pgbouncer
CMD ["pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
