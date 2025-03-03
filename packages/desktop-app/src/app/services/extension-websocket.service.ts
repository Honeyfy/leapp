import { Injectable } from "@angular/core";
import { AppNativeService } from "./app-native.service";
import { AppProviderService } from "./app-provider.service";
import { Session } from "@noovolari/leapp-core/models/session";
import { AwsSessionService } from "@noovolari/leapp-core/services/session/aws/aws-session-service";
import { BehaviorSubject } from "rxjs";
import { MessageToasterService, ToastLevel } from "./message-toaster.service";

export enum FetchingState {
  notFetching,
  fetchingRequested,
  fetching,
}

@Injectable({
  providedIn: "root",
})
export class ExtensionWebsocketService {
  public wsServer: any;
  public port: string;
  public wsClient: any;
  public fetching$: BehaviorSubject<FetchingState>;
  private fetchingTimeout: any;

  constructor(
    private appNativeService: AppNativeService,
    private appProviderService: AppProviderService,
    private toastService: MessageToasterService
  ) {
    this.fetching$ = new BehaviorSubject(FetchingState.notFetching);
    this.fetching$.subscribe(async (value) => {
      clearTimeout(this.fetchingTimeout);
      if (value === FetchingState.fetching) {
        await this.pause();
        this.sendMessage(JSON.stringify({ type: "get-fetching-state" }));
        this.fetchingTimeout = setTimeout(() => {
          this.fetching$.next(FetchingState.notFetching);
          this.toastService.toast("Error: cannot communicate with the browser extension", ToastLevel.error);
        }, 4000);
      }
    });
  }

  bootstrap(): void {
    const ws = this.appNativeService.ws;
    this.wsServer = new ws.WebSocketServer({
      //TODO add configurable port option
      port: 8095,
    });
    this.wsServer.on("connection", (wsClient) => {
      this.wsClient = wsClient;
      this.wsClient.on("message", (data) => {
        const parsedData = JSON.parse(data.toString("utf8"));
        if (parsedData.type === "send-fetching-state") {
          this.fetching$.next(parsedData.fetching ? FetchingState.fetching : FetchingState.notFetching);
        }
      });
    });
  }

  sendMessage(payload: any): void {
    this.wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  async openWebConsoleWithExtension(session: Session): Promise<void> {
    this.fetching$.next(FetchingState.fetchingRequested);
    this.appProviderService.behaviouralSubjectService.unselectSessions();
    const sessionService = this.appProviderService.sessionFactory.getSessionService(session.type) as AwsSessionService;
    const credentialsInfo = await sessionService.generateCredentials(session.sessionId);
    const url = await this.appProviderService.webConsoleService.getWebConsoleUrl(credentialsInfo, session.region);
    this.sendMessage(
      JSON.stringify({
        type: "create-new-session",
        sessionInfo: {
          url,
          sessionName: session.sessionName,
          sessionRole: (session as any).roleArn.split("/")[1],
          sessionRegion: session.region,
          sessionType: session.type.toString().startsWith("aws") ? "aws" : session.type.toString(),
        },
      })
    );
    this.fetching$.next(FetchingState.fetching);
    this.toastService.toast("Opening Web Console with the Leapp Extension...", ToastLevel.info);
  }

  private pause(): Promise<void> {
    return new Promise((resolve, _) => {
      const timeout = setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 300);
    });
  }
}
