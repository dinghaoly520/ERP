import { Module } from '@nestjs/common';
import { ExpertPairingRegistry } from './expert-pairing.registry';

/** TAB-SYNC-01 平板配对登记——auth / expert / bid 三模块共享（AuthGuard 存活查询、
 *  claim 登记、解绑/登出吊销、主持端面板）。'REDIS_CLIENT' 由 @Global RedisModule 提供。 */
@Module({
  providers: [ExpertPairingRegistry],
  exports: [ExpertPairingRegistry],
})
export class ExpertPairingModule {}
