/**
 * Agent World Protocol — Main Server Entry Point
 *
 * Wires together: Database, WorldState, TickEngine, ConnectionManager, RestAPI, Bridges.
 * Loads .env if present. Defaults are Solana devnet + a simulated economy.
 */

require('dotenv').config();

const { loadConfig, publicConfig } = require('./config');
const { WorldState } = require('./server/WorldState');
const { TickEngine } = require('./server/TickEngine');
const { ConnectionManager } = require('./server/ConnectionManager');
const { RestAPI } = require('./server/RestAPI');
const { BridgeManager } = require('./bridges/BridgeManager');
const { SolanaBridge } = require('./bridges/SolanaBridge');
const { JupiterBridge } = require('./bridges/JupiterBridge');
const { PumpFunBridge } = require('./bridges/PumpFunBridge');
const { NFTBridge } = require('./bridges/NFTBridge');
const { PolymarketBridge } = require('./bridges/PolymarketBridge');
const { SocialBridge } = require('./bridges/SocialBridge');
const { DataBridge } = require('./bridges/DataBridge');
const { Database } = require('./database/Database');

const CONFIG = loadConfig();

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       AGENT WORLD PROTOCOL v0.3.1           ║');
  console.log('║     Browser world · devnet · simulated       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  if (CONFIG.errors.length > 0) {
    console.error('[Config] Refusing to start:');
    for (const e of CONFIG.errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  if (CONFIG.warnings.length > 0) {
    console.log('[Config] Environment notes:');
    for (const w of CONFIG.warnings) console.log(`  ⚠ ${w}`);
    console.log('');
  }

  // Database
  const db = new Database({
    connectionString: CONFIG.DATABASE_URL,
    saveInterval: CONFIG.DB_SAVE_INTERVAL,
  });
  await db.connect();

  // World state
  const world = new WorldState({
    PERCEPTION_RADIUS: CONFIG.PERCEPTION_RADIUS,
    ZONE_SIZE: CONFIG.ZONE_SIZE,
    STARTER_GRANT: CONFIG.STARTER_GRANT_LAMPORTS,
  });

  const loaded = await db.loadWorld(world);
  if (!loaded) {
    console.log(`[World] Fresh world: ${world.zones.size} zones, ${world.tiles.size} tiles`);
  }

  // No one is connected yet — mark all restored agents offline so they stay
  // hidden until their owner logs back in.
  for (const agent of world.agents.values()) {
    if (agent.status === 'active') agent.status = 'offline';
  }

  // Tick engine
  const engine = new TickEngine(world, { tickRate: CONFIG.TICK_RATE });

  // WebSocket connections
  const connections = new ConnectionManager(world, engine, { port: CONFIG.WS_PORT });

  // REST API
  const api = new RestAPI(world, connections, {
    port: CONFIG.API_PORT,
    publicConfig: publicConfig(CONFIG),
  });

  // Bridges — RPC defaults to devnet. Transfers stay simulated while DRY_RUN is true.
  const bridgeManager = new BridgeManager(world, { feeCollectorWallet: CONFIG.FEE_WALLET });
  bridgeManager.register('solana', new SolanaBridge({ rpcUrl: CONFIG.SOLANA_RPC, network: CONFIG.SOLANA_NETWORK, feeWallet: CONFIG.FEE_WALLET, dryRun: CONFIG.DRY_RUN }));
  bridgeManager.register('jupiter', new JupiterBridge({ feeWallet: CONFIG.FEE_WALLET, dryRun: CONFIG.DRY_RUN }));
  bridgeManager.register('pumpfun', new PumpFunBridge({ feeWallet: CONFIG.FEE_WALLET, dryRun: CONFIG.DRY_RUN }));
  bridgeManager.register('nft', new NFTBridge({ rpcUrl: CONFIG.SOLANA_RPC, network: CONFIG.SOLANA_NETWORK, feeWallet: CONFIG.FEE_WALLET, dryRun: CONFIG.DRY_RUN }));
  bridgeManager.register('polymarket', new PolymarketBridge({ feeWallet: CONFIG.FEE_WALLET, dryRun: CONFIG.DRY_RUN }));
  bridgeManager.register('social', new SocialBridge({ dryRun: CONFIG.DRY_RUN }));
  bridgeManager.register('data', new DataBridge({ dryRun: CONFIG.DRY_RUN }));

  engine.on('tick', (tickResult) => {
    for (const event of tickResult.events) {
      if (event.type === 'bridge_request') {
        bridgeManager.execute(event.agentId, event.bridge, event.bridgeAction, event.params || {})
          .then(result => {
            const client = connections.clients.get(event.agentId);
            if (client && client.ws.readyState === 1) {
              client.ws.send(JSON.stringify({ type: 'bridge_result', bridge: event.bridge, action: event.bridgeAction, result }));
            }
          })
          .catch(err => console.error(`[Bridge] ${event.bridge}/${event.bridgeAction}: ${err.message}`));
      }
    }
  });

  api.bridgeManager = bridgeManager;
  api.db = db;

  // Persist chat messages and broadcast webhook alerts
  engine.on('tick', (tickResult) => {
    for (const event of tickResult.events) {
      // Persist chat
      if (event.type === 'agent_spoke') {
        db.saveChatMessage({ fromAgentId: event.agentId, fromName: event.name, message: event.message, channel: 'world', tick: event.tick })
          .catch(err => console.error('[DB] Chat save error:', err.message));
      } else if (event.type === 'whisper') {
        db.saveChatMessage({ fromAgentId: event.fromAgentId, fromName: event.fromName, message: event.message, channel: 'dm', targetAgentId: event.toAgentId, tick: event.tick })
          .catch(err => console.error('[DB] Chat save error:', err.message));
      }
    }
    // Broadcast webhook alerts
    api._broadcastWebhookEvents(tickResult.events);
  });

  engine.on('tick', (tickResult) => {
    api.broadcastSSE({
      type: 'tick',
      tick: tickResult.tick,
      events: tickResult.events,
      stats: { agents: tickResult.agentCount, zones: tickResult.zoneCount, processingTime: tickResult.processingTime },
    });
  });

  // Start everything — single port mode (REST + WebSocket on same port)
  const httpServer = api.start();
  connections.start(httpServer); // attach WebSocket to the same HTTP server
  engine.start();
  db.startAutoSave(world);

  console.log('');
  console.log(`[Server] Running on port ${CONFIG.API_PORT} (HTTP + WebSocket combined)`);
  console.log(`[Server] Tick Rate:  ${CONFIG.TICK_RATE}ms`);
  console.log(`[Server] Network:    ${CONFIG.SOLANA_NETWORK} (dryRun: ${CONFIG.DRY_RUN})`);
  console.log(`[Server] Bridges:    solana, jupiter, pumpfun, nft, polymarket, social, data`);
  console.log(`[Server] Database:   ${db.enabled ? 'PostgreSQL (persistent)' : 'Memory only (no DATABASE_URL)'}`);
  console.log('');
  console.log(`[Server] Play:       http://localhost:${CONFIG.API_PORT}/`);
  console.log(`[Server] Dashboard:  http://localhost:${CONFIG.API_PORT}/dashboard`);
  console.log(`[Server] WebSocket:  ws://localhost:${CONFIG.API_PORT}`);
  console.log(`[Server] API Stats:  http://localhost:${CONFIG.API_PORT}/api/stats`);
  console.log('');
  console.log('[Server] World is live. Open /play to join.');
  console.log('');

  // Graceful shutdown — save world before exit
  async function shutdown() {
    console.log('\n[Server] Shutting down...');
    engine.stop();
    if (db.enabled) {
      console.log('[Server] Saving world state...');
      await db.saveWorld(world);
      await db.close();
    }
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => {
    console.error('[Server] Unhandled promise rejection:', err);
  });
}

main().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
