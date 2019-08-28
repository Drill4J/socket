import { Subscription } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

export interface DrillResponse {
  message: string;
  destination: string;
  type: string;
}

export class DrillSocket {
  public connection$: WebSocketSubject<DrillResponse>;
  public subscription: Subscription;
  constructor(socket: string = 'drill-admin-socket') {
    // @ts-ignore
    this.connection$ = new webSocket<DrillResponse>(
      process.env.REACT_APP_ENV
        ? `wss://${window.location.host}/ws/${socket}`
        : `wss://localhost:8443/ws/${socket}`,
    );

    this.subscription = this.connection$.subscribe();
  }

  public subscribe(topic: string, callback: (arg: any) => void, message?: object) {
    const subscription = this.connection$.subscribe(
      ({ destination, message: responseMessage }: DrillResponse) =>
        destination === topic && callback(responseMessage ? JSON.parse(responseMessage) : null),
    );
    this.send(topic, 'SUBSCRIBE', message);

    return () => {
      subscription.unsubscribe();
      this.send(topic, 'UNSUBSCRIBE');
    };
  }

  public send(destination: string, type: string, message?: object) {
    this.connection$.next({
      destination,
      type,
      message: JSON.stringify(message),
    });
  }
}
