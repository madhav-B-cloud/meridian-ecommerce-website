'use strict';
/**
 * In-process stand-in for Apache Kafka.
 *
 * The original platform exchanges JSON events over the topics
 * `product-events`, `inventory-events` and `order-events` to run the
 * order Saga. Here the same three topics exist, with the same event
 * payloads, dispatched synchronously through an EventEmitter so the
 * whole flow is visible (and loggable) without any infrastructure.
 */
const { EventEmitter } = require('events');

const MAX_HISTORY = 500;

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Capped, append-only record of everything that moved through the bus. */
const history = [];

const COLORS = {
  'product-events': '\x1b[36m',   // cyan
  'inventory-events': '\x1b[33m', // yellow
  'order-events': '\x1b[35m',     // magenta
};
const RESET = '\x1b[0m';

function publish(topic, event) {
  const envelope = {
    topic,
    eventType: event.eventType,
    payload: event,
    occurredAt: new Date().toISOString(),
  };
  history.push(envelope);
  if (history.length > MAX_HISTORY) history.shift();

  const color = COLORS[topic] || '';
  console.log(
    `${color}[kafka:${topic}]${RESET} ${event.eventType}` +
    (event.sku ? ` sku=${event.sku}` : '') +
    (event.orderNumber ? ` order=${event.orderNumber}` : '')
  );

  // Async dispatch so consumers behave like real Kafka consumers
  // (the producer call returns before listeners finish).
  setImmediate(() => bus.emit(topic, event));
  return envelope;
}

function subscribe(topic, handler) {
  bus.on(topic, handler);
}

function recent(limit = 50) {
  return history.slice(-limit).reverse();
}

module.exports = { publish, subscribe, recent };
