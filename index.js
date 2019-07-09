// Import the API, Keyring and some utility functions
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');

// Known account we want to use (available on dev chain, with funds)
const Alice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const Bob = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const customTypes = {
  TokenBalance: "u128",
  ChildChainId: "u32"
};

async function main () {
  const parent = process.env.PARENT;
  const child = process.env.CHILD;
  const parentApi = await ApiPromise.create({
    provider: new WsProvider(parent),
    types: customTypes
  });
  const childApi = await ApiPromise.create({
    provider: new WsProvider(child),
    types: customTypes
  });

  // Constuct the keying after the API (crypto has an async init)
  const keyring = new Keyring({ type: 'sr25519' });
  // Add alice to our keyring with a hard-deived path (empty phrase, so uses dev)
  const alice = keyring.addFromUri('//Alice');

  let supplies = {
    parent: {
      init: false,
      totalSupply: 0,
      localSupply: 0,
      childSupply: 0,
    },
    child: {
      init: false,
      totalSupply: 0,
      localSupply: 0,
      parentSupply: 0,
    }
  }

  supplies.parent.init = await parentApi.query.token.init();
  supplies.parent.totalSupply = await parentApi.query.token.totalSupply();
  supplies.parent.localSupply = await parentApi.query.token.localSupply();
  supplies.parent.childSupply = await parentApi.query.token.childSupplies(0);
  console.log(`init status on the parent chain: ${supplies.parent.init}`);
  console.log(`totalSupply on the parent chain: ${supplies.parent.totalSupply}`);
  console.log(`localSupply on the parent chain: ${supplies.parent.localSupply}`);
  console.log(`childSupply on the parent chain: ${supplies.parent.childSupply}`);

  supplies.child.init = await childApi.query.token.init();
  supplies.child.totalSupply = await childApi.query.token.totalSupply();
  supplies.child.localSupply = await childApi.query.token.localSupply();
  supplies.child.parentSupply = await childApi.query.token.parentSupply();
  console.log(`init status on the child chain: ${supplies.child.init}`);
  console.log(`totalSupply on the child chain: ${supplies.child.totalSupply}`);
  console.log(`localSupply on the child chain: ${supplies.child.localSupply}`);
  console.log(`parentSupply on the child chain: ${supplies.child.parentSupply}`);

  parentApi.query.token.init(async (init) => {
    supplies.parent.init = init;
    if (supplies.parent.init.valueOf() && supplies.child.init.valueOf()) {
      console.log(1)
      syncTokenStatus(parentApi, childApi, supplies, alice);
    }
  })

  childApi.query.token.init(async (init) => {
    supplies.child.init = init;
    if (supplies.parent.init.valueOf() && supplies.child.init.valueOf()) {
     syncTokenStatus(parentApi, childApi, supplies, alice);
    }
  })
}

function syncTokenStatus(parentApi, childApi, supplies, owner) {
  syncTokenStatus = function() {};
  console.log("watch start");

  // Watch send token from parent to child
  parentApi.query.token.childSupplies(0, async (current) => {
    let change = current.sub(supplies.parent.childSupply);
    let local = await parentApi.query.token.localSupply();
    let localChange = local.sub(supplies.parent.localSupply);
    supplies.parent.childSupply = current;
    supplies.parent.localSupply = local;

    // Detect send token from parent to child
    if (!change.isZero() && !change.isNeg() && localChange.isNeg()) {
      console.log(`New childSupply on the parent chain: ${current}`);
      receiveFromParent(childApi, owner, change);
    }
  })

  // Watch send token from child to parent
  childApi.query.token.parentSupply(async (current) => {
    let change = current.sub(supplies.child.parentSupply);
    let local = await childApi.query.token.localSupply();
    let localChange = local.sub(supplies.child.localSupply);
    supplies.child.parentSupply = current;
    supplies.child.localSupply = local;

    // Detect send token child to parent
    if (!change.isZero() && !change.isNeg() && localChange.isNeg()) {
      console.log(`New childSupply on the parent chain: ${current}`);
      receiveFromChild(parentApi, owner, change);
    }
  })

  // Watch total supply on the parent
  parentApi.query.token.totalSupply(async (current) => {
    let change = current.sub(supplies.parent.totalSupply);

    if (!change.isZero()) {
      supplies.parent.totalSupply = current;
      supplies.parent.localSupply = await parentApi.query.token.localSupply();
      console.log(`New totalSupply on the parent chain: ${current}`);
      let diff = supplies.parent.totalSupply.sub(supplies.child.totalSupply);

      if (!diff.isZero()) {
        // update total supply on the child
        if (diff.isNeg()) {
          burnToken(childApi, owner, diff.abs());
        } else {
          mintToken(childApi, owner, diff.abs());
        }
      }
    }
  })

  // Watch total supply on the child
  childApi.query.token.totalSupply(async (current) => {
    let change = current.sub(supplies.child.totalSupply);

    if (!change.isZero()) {
      supplies.child.totalSupply = current;
      console.log(`New totalSupply on the child chain: ${current}`);
    }
  })
}

async function showTokenStatus(api) {
  let now = await api.query.timestamp.now();
  let init = await api.query.token.init();
  let totalSupply = await api.query.token.totalSupply();
  let localSupply = await api.query.token.localSupply();
  let owner = await api.query.token.owner();
  let parentSupply = await api.query.token.parentSupply();

  console.log(`=== show token status ===`);
  console.log(`Timestamp: ${now}`);
  console.log(`Token init status: ${init}`);
  console.log(`Token total supply: ${totalSupply}`);
  console.log(`Token local supply: ${localSupply}`);
  console.log(`Token parent supply: ${parentSupply}`);
  console.log(`Token owner: ${owner}`);
  console.log('');
}

async function showTokenBalances(api) {
  let balanceOf = {};
  balanceOf[Alice] = await api.query.token.balanceOf(Alice);
  balanceOf[Bob] = await api.query.token.balanceOf(Bob);

  console.log(`=== show token balances ===`);
  console.log(`Balance of Alice: ${balanceOf[Alice]}`);
  console.log(`Balance of Bob: ${balanceOf[Bob]}`);
  console.log('');
}

async function mintToken(api, owner, value) {
  const tx = api.tx.token.mint(value);
  const hash = await tx.signAndSend(owner);

  console.log('=== mint token ===');
  console.log(`Mint ${value} token with hash: ${hash.toHex()}`);
  console.log('');
}

async function burnToken(api, owner, value) {
  const tx = api.tx.token.burn(value);
  const hash = await tx.signAndSend(owner);

  console.log('=== burn token ===');
  console.log(`Burn ${value} token with hash: ${hash.toHex()}`);
  console.log('');
}

async function sendToken(api, sender, receiver, value) {
  // Create a extrinsic, transferring tokens to the receiver
  const transfer = api.tx.token.transfer(receiver, value);
  // Sign and send the transaction using our account
  const hash = await transfer.signAndSend(sender);

  console.log('=== send token ===');
  console.log(`Transfer ${value} token sent with hash: ${hash.toHex()}`);
  console.log('');
}

async function receiveFromParent(api, sender, value) {
  const tx = api.tx.token.receiveFromParent(value);
  const hash = await tx.signAndSend(sender);

  console.log('=== send receive from parent ===');
  console.log(`Receive ${value} token from parent with hash: ${hash.toHex()}`);
  console.log('');
}

async function receiveFromChild(api, sender, value) {
  const tx = api.tx.token.receiveFromChild(0, value);
  const hash = await tx.signAndSend(sender);

  console.log('=== send receive from child ===');
  console.log(`Receive ${value} token from child with hash: ${hash.toHex()}`);
  console.log('');
}

// main().catch(console.error).finally(_ => process.exit());
main().catch(console.error);
