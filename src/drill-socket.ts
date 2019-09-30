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
  constructor(url: string) {
    this.connection$ = webSocket<DrillResponse>(url);

    this.subscription = this.connection$.subscribe(({ type }: DrillResponse) => {
      if (type === 'UNAUTHORIZED') {
        this.handleUnauthorized();
      }
    });
  }

  public subscribe(topic: string, callback: (arg: any) => void, message?: object) {
    const subscription = this.connection$.subscribe(
      ({ destination, message: responseMessage }: DrillResponse) =>
        destination === topic && callback(responseMessage || null),
    );
    this.send(topic, 'SUBSCRIBE', message);

    return () => {
      subscription.unsubscribe();
      this.send(topic, 'UNSUBSCRIBE');
    };
  }

  public reconnect(url: string) {
    this.connection$ = webSocket<DrillResponse>(url);

    this.subscription = this.connection$.subscribe(({ type }: DrillResponse) => {
      if (type === 'UNAUTHORIZED') {
        this.handleUnauthorized();
      }
    });
  }

  private handleUnauthorized() {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  public send(destination: string, type: string, message?: object) {
    this.connection$.next({
      destination,
      type,
      message: JSON.stringify(message),
    });
  }
}
