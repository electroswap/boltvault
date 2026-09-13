/**
 * A farm that cannot pay a boost must not be shown one (ES-BV-088).
 *
 * A beta tester opened CLUB/DYNO and was shown a 1.02× dial, "No BOLT boost
 * yet · 50,000 more BOLT for 1.05×", "2.0× on 9 May · 2.5× on 8 Sept", and a
 * BOLT field on the deposit sheet. "Is this correct for CLUB/DYNO farm? I
 * didn't think it had Bolt boosts?"
 *
 * They were right, and the contract says so plainly. In
 * `YieldFarm._collectRewardsAndFees`:
 *
 *     rewardsCollected = (rewardsEarned * farmer.boltMultiplier
 *                         * _calculateDurationMultiplier(...)) / 100000000;
 *     rewardToken.mint(msg.sender, rewardsCollected);
 *     ...
 *     thirdPartyRewardsCollected = newThirdPartyDebt - farmer.thirdPartyRewardDebt;
 *     IERC20(thirdPartyReward.token).transfer(msg.sender, thirdPartyRewardsCollected);
 *
 * Both multipliers apply to the minted native reward and to nothing else; the
 * third-party token is transferred straight through, unmultiplied. And
 * `rewardsEarned` comes from `accRewardsPerShare`, fed in
 * `_updateFarmRewardsAndFees` by
 *
 *     rewards = blocksSinceLastCalc
 *             * ((rewardPerBlock * farm.allocPoint) / totalAllocPoint);
 *
 * So with `allocPoint` at zero the farm mints nothing, and the entire boost
 * apparatus multiplies zero. CLUB/DYNO is that farm — all of its yield is
 * CLUB — so no amount of BOLT and no amount of waiting could ever have changed
 * a thing the wallet was offering.
 *
 * The web interface already gates on the same fact (`farm.allocation > 0` in
 * `apps/interface/src/components/Farms/FarmRow.tsx`, which hides both
 * multipliers and declines to apply them to APY). The wallet had no signal at
 * all: `FarmTuple` decoded the struct and dropped `allocPoint` on the floor.
 */
import { describe, expect, it } from 'vitest'
import { farmBoosted } from '../src/namespaces/farm'

describe('whether a farm can pay a BOLT or duration boost', () => {
  it('can, when it has a share of the native emission', () => {
    expect(farmBoosted(1n)).toBe(true)
    expect(farmBoosted(1000n)).toBe(true)
  })

  it('cannot, with no allocation — every multiplier there multiplies zero', () => {
    expect(farmBoosted(0n)).toBe(false)
  })

  /*
    The predicate is allocation, not "does it have a third-party reward".

    A farm can have both: an allocation that mints DYNO and a sponsor's token
    on top. There the multipliers are real — they just do not touch the
    sponsor's half. Keying the UI off the presence of a third-party reward
    would hide a boost that genuinely pays.
  */
  it('is decided by allocation alone, so a sponsored farm that also mints keeps its boost', () => {
    expect(farmBoosted(5n)).toBe(true)
  })
})
