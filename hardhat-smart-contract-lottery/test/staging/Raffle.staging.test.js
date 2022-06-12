const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Test", () => {
      let raffle, deployer, raffleEntranceFee;
      beforeEach(async () => {
        accounts = await ethers.getSigners(); // could also do with getNamedAccounts
        deployer = accounts[0];
        raffle = await ethers.getContract("Raffle", deployer);
        raffleEntranceFee = await raffle.getEntrenceFee();
      });

      describe("fullfillRandomWords", () => {
        it("works with live chainlink keepers and vrf", async () => {
          accounts = await ethers.getSigners(); // could also do with getNamedAccounts

          const startingTimestamp = await raffle.getLatestTimestamp();
          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("Winner picked event fired");
              try {
                const recentWinner = await raffle.getRecentWinner();
                const raffleState = await raffle.getRaffleState();
                const winnerEndingBalance = await accounts[0].getBalance();
                const endingTimestamp = await raffle.getLatestTimestamp();

                await expect(raffle.getPlayer(0)).to.be.reverted;
                assert.equal(recentWinner.toString(), accounts[0].address);
                assert(raffleState == 0);
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(raffleEntranceFee).toString()
                );
                assert(endingTimestamp > startingTimestamp);

                resolve();
              } catch (e) {
                reject(e);
              }
            });

            await raffle.enterRaffle({ value: raffleEntranceFee });
            const winnerStartingBalance = await accounts[0].getBalance();
            // won't move on until our listner is finished
          });
        });
      });
    });
