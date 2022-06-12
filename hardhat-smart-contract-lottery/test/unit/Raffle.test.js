const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Test", () => {
      let raffle, vrfCoordinatorV2Mock, deployer, interval, raffleEntranceFee;
      const chainId = network.config.chainId;

      beforeEach(async () => {
        accounts = await ethers.getSigners(); // could also do with getNamedAccounts
        deployer = accounts[0];
        await deployments.fixture(["all"]);
        raffle = await ethers.getContract("Raffle", deployer);
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
        interval = await raffle.getInterval();
        raffleEntranceFee = await raffle.getEntrenceFee();
      });

      describe("Constructor", () => {
        it("Initializes the raffle correctly", async () => {
          const raffleState = await raffle.getRaffleState();
          assert(raffleState.toString(), "0");
          assert(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });

      describe("Enter raffle", () => {
        it("Reverts if not enough incentive", async () => {
          await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETH");
        });
        it("Records players when they entered", async () => {
          const tranResponse = await raffle.enterRaffle({
            value: networkConfig[chainId]["raffleEntranceFee"],
          });
          await tranResponse.wait(1);
          const nrOfPlayers = await raffle.getNumberOfPlayers();
          assert("1", nrOfPlayers.toString());
        });
        it("Emits event at enter", async () => {
          await expect(
            raffle.enterRaffle({ value: networkConfig[chainId]["raffleEntranceFee"] })
          ).to.emit(raffle, "RaffleEnter");
        });
        it("Does not allow entrece when raffle is calculating", async () => {
          await raffle.enterRaffle({ value: networkConfig[chainId]["raffleEntranceFee"] });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.send("evm_mine", []);

          // We pretend to be chainlink keeper nodes
          await raffle.performUpkeep([]);

          await expect(
            raffle.enterRaffle({ value: networkConfig[chainId]["raffleEntranceFee"] })
          ).to.be.revertedWith("Raffle__NotOpened");
        });
      });
      describe("checkUpkeep", function () {
        it("returns false if people haven't sent any ETH", async () => {
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
          assert(!upkeepNeeded);
        });

        it("returns false if raffle isn't open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          await raffle.performUpkeep([]);
          const raffleState = await raffle.getRaffleState();
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
          assert.equal(raffleState.toString() == "1", upkeepNeeded == false);
        });
        it("returns false if enough time hasn't passed", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() - 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
          assert(!upkeepNeeded);
        });
        it("returns true if enough time has passed, has players, eth, and is open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
          assert(upkeepNeeded);
        });
      });
      describe("performUpkeep", function () {
        it("can only run if checkupkeep is true", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const tx = await raffle.performUpkeep("0x");
          assert(tx);
        });
        it("reverts if checkup is false", async () => {
          await expect(raffle.performUpkeep("0x")).to.be.revertedWith("Raffle__UpkeepNotNeeded");
        });
        it("updates the raffle state and emits a requestId", async () => {
          // Too many asserts in this test!
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });

          const txResponse = await raffle.performUpkeep("0x");
          const txReceipt = await txResponse.wait(1);
          const raffleState = await raffle.getRaffleState();
          const requestId = txReceipt.events[1].args.requestId;

          assert(requestId.toNumber() > 0);
          assert(raffleState == 1);
        });
      });
      describe("fulfillRandomWords", function () {
        beforeEach(async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
        });
        it("can only be called after performupkeep", async () => {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
          ).to.be.revertedWith("nonexistent request");
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
          ).to.be.revertedWith("nonexistent request");
        });

        it("picks a winner, resets, and sends money", async () => {
          const additionalEntrances = 3;
          const startingAccountIndex = 1; // deployer = 0
          for (let i = startingAccountIndex; i < additionalEntrances + startingAccountIndex; ++i) {
            const accountConnnectedRaffle = await raffle.connect(accounts[i]);
            await accountConnnectedRaffle.enterRaffle({ value: raffleEntranceFee });
          }

          const startingTimestamp = await raffle.getLatestTimestamp();
          // performupkeep (mock being chainlink keeper)
          // => triggers fulfillRandomWords (mock being chainlink vrf)
          // We'll have to wait for fulfillRandomWords to be called. Since we are on a test environment
          // we can easily wait for the block with a line of code. But we are going to simulate like we
          // do need to wait. => We need a listener => A promise

          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("We found a winner!!");
              try {
                const recentWinner = await raffle.getRecentWinner();
                const raffleState = await raffle.getRaffleState();
                const endingTimestamp = await raffle.getLatestTimestamp();
                const numPlayers = await raffle.getNumberOfPlayers();
                const winnerEndingBalance = await accounts[1].getBalance();

                console.log(recentWinner);
                console.log(accounts[0].address);
                console.log(accounts[1].address);
                console.log(accounts[2].address);
                console.log(accounts[3].address);

                assert.equal(numPlayers.toString(), "0");
                assert.equal(raffleState.toString(), "0");
                assert(endingTimestamp > startingTimestamp);
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance
                    .add(raffleEntranceFee.mul(additionalEntrances).add(raffleEntranceFee))
                    .toString()
                );
              } catch (e) {
                reject(e);
              }
              resolve();
            });

            const tx = await raffle.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const winnerStartingBalance = await accounts[1].getBalance();
            await vrfCoordinatorV2Mock.fulfillRandomWords(
              txReceipt.events[1].args.requestId,
              raffle.address
            );
          });
        });
      });
    });
