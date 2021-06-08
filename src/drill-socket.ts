/*
 * Copyright 2020 EPAM Systems
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Observable, Subject, Subscription, timer } from 'rxjs';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { mergeMap, pairwise, retryWhen } from 'rxjs/operators';

import { SubscribersCollection } from './subscribers-collection';
import { TOKEN_KEY } from './token-key';

export interface DrillResponse {
  message: string;
  destination: string;
  type: string;
  to?: { agentId?: string; groupId?: string; buildVersion?: string };
}

export interface SubscriptionMessage {
  agentId: string;
  buildVersion: string;
}

export const genericRetryStrategy = () => (attempts: Observable<any>) =>
  attempts.pipe(mergeMap(() => timer(5000)));

export class DrillSocket {
  public ws$: WebSocketSubject<DrillResponse>;

  public subscription: Subscription;

  public onCloseEvent: (value?: CloseEvent) => void = () => {};

  public onOpenEvent: () => void = () => {};

  public connection$: Observable<DrillResponse>;

  public reconnection$: Subject<'CLOSE' | 'OPEN'>;

  private subscribers: SubscribersCollection;

  constructor(url: string) {
    this.ws$ = webSocket<DrillResponse>({
      url,
      closeObserver: {
        next: () => {
          this.reconnection$.next('CLOSE');
        },
      },
      openObserver: {
        next: () => {
          this.reconnection$.next('OPEN');
        },
      },
    });
    this.connection$ = this.ws$.pipe(retryWhen(genericRetryStrategy()));

    this.subscription = this.connection$.subscribe(({ type }: DrillResponse) => {
      if (type === 'UNAUTHORIZED') {
        this.handleUnauthorized();
      }
    });
    this.reconnection$ = new Subject();
    this.subscribers = new SubscribersCollection();
    this.reconnection$.pipe(pairwise()).subscribe((value) => {
      const [prev, current] = value;
      if (current === 'CLOSE') {
        this.onCloseEvent();
      }
      if (prev === 'CLOSE' && current === 'OPEN') {
        this.onOpenEvent();
      }
    });
  }

  public subscribe(
    topic: string,
    callback: (arg: any) => void,
    message?: SubscriptionMessage | Record<string, unknown>,
  ) {
    const encodedTopic = encodeURIComponent(topic).replace(/%2F/g, '/');
    const key = createSubscriberKey(encodedTopic, message);
    let subscription = this.createSubscription(key, encodedTopic, callback, message);

    const autoSubscription = this.reconnection$.subscribe((type) => {
      if (type === 'CLOSE') {
        subscription.unsubscribe();
        this.subscribers.removeSubscriber(key);
      }
      if (type === 'OPEN' && subscription.closed) {
        this.send(encodedTopic, 'SUBSCRIBE', message);
        subscription = this.createSubscription(key, encodedTopic, callback, message);
      }
    });

    return () => {
      subscription.unsubscribe();
      autoSubscription.unsubscribe();
      if (this.subscribers.get(key).quantity === 1) {
        this.subscribers.setDelay(key, true);
        setTimeout(() => {
          if (this.subscribers.get(key).quantity === 0) {
            this.send(encodedTopic, 'UNSUBSCRIBE', message);
          }
          this.subscribers.setDelay(key, false);
        }, 1000);
      }
      this.subscribers.removeSubscriber(key);
    };
  }

  // eslint-disable-next-line class-methods-use-this
  private handleUnauthorized() {
    localStorage.setItem(TOKEN_KEY, '');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  public send(
    destination: string,
    type: string,
    message?: SubscriptionMessage | Record<string, unknown>,
  ) {
    this.ws$.next({
      destination,
      type,
      message: JSON.stringify(message),
    });
  }

  private createSubscription(
    key: string,
    topic: string,
    callback: (arg: any) => void,
    message?: SubscriptionMessage | Record<string, unknown>,
  ) {
    if (!this.subscribers.has(key) && !this.subscribers.get(key)?.isDelayUnsubscribe) {
      this.send(topic, 'SUBSCRIBE', message);
    } else {
      callback(this.subscribers.get(key).lastValue);
    }
    this.subscribers.addSubscriber(key);
    return this.connection$.subscribe({
      next: nextMessageHandler(topic, callback, this.subscribers, message),
    });
  }
}

const nextMessageHandler = (
  topic: string,
  callback: (arg: any) => void,
  subscribers: SubscribersCollection,
  message?: SubscriptionMessage | Record<string, unknown>,
) => ({ destination, message: responseMessage, to }: DrillResponse) => {
  if (destination !== topic) {
    return;
  }
  const key = createSubscriberKey(topic, message);
  if (!to && !message) {
    callback(responseMessage || null);
    subscribers.setSubscriberValue(key, responseMessage);
    return;
  }

  const {
    agentId: subscriptionAgentId,
    buildVersion: subscriptionBuildVersion,
  } = message as SubscriptionMessage;
  const { agentId: messageAgentId, buildVersion: messageBuildVersion } = to as SubscriptionMessage;
  if (subscriptionAgentId === messageAgentId && subscriptionBuildVersion === messageBuildVersion) {
    callback(responseMessage || null);
    subscribers.setSubscriberValue(key, responseMessage);
  }
};

function createSubscriberKey(
  topic: string,
  message?: SubscriptionMessage | Record<string, unknown>,
) {
  return topic + JSON.stringify(message);
}
