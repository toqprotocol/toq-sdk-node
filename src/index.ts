/**
 * toq protocol Node SDK.
 *
 * Thin client to the local toq daemon. The daemon handles all protocol
 * complexity (crypto, TLS, handshake, connections). This SDK provides
 * sync and async interfaces for agent code.
 *
 * Usage:
 *   import { connect } from 'toq';
 *   const client = connect();
 *   await client.send('toq://peer.com/agent', 'hello');
 *
 *   for await (const msg of client.messages()) {
 *     await msg.reply('got it');
 *   }
 */

export { Client, connect } from "./client";
export { Message } from "./client";
export { ToqError } from "./client";
