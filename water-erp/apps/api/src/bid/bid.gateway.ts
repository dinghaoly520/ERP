import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'bid',
  cors: { origin: '*', credentials: true },
})
export class BidGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('join:project')
  handleJoinProject(client: Socket, projectId: string) {
    client.join(`project:${projectId}`);
  }

  @SubscribeMessage('leave:project')
  handleLeaveProject(client: Socket, projectId: string) {
    client.leave(`project:${projectId}`);
  }

  notifyDecryptStatus(projectId: string, data: {
    supplierId: string;
    decryptStatus: string;
    supplierName: string;
  }) {
    this.server.to(`project:${projectId}`).emit('decrypt:update', data);
  }

  notifySupervisionLog(projectId: string, log: any) {
    this.server.to(`project:${projectId}`).emit('supervision:log', log);
  }

  notifyStageChange(projectId: string, stage: string) {
    this.server.to(`project:${projectId}`).emit('stage:change', { stage });
  }
}
