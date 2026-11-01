// What each criterion means and how to score it, from the original Ideation Calculator
// board's column descriptions and from the evaluation framework (gates and the
// 12-line scorecard). Scoring guides are written in stars, best first: board
// guides cover every star count, and framework guides describe 1, 3 and 5 stars
// (its 0, 2 and 4 points), with 2 or 4 stars for an idea in between.
//
// Per criterion (all optional):
//   summary  one-line question shown under the criterion name
//   details  paragraphs; a leading "Example A:" or "Examples:" is set in bold
//   scale    the scoring guide lines, each starting with its stars ("3 stars:")
//   scaleLabel  heading for the scale, when it isn't the board's
//   warning  a closing caution
//   note     id of a note in NOTES, shown in this criterion's guide
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IdeaDescriptions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CRITERIA = {
    // ---------- Evaluation framework: gates ----------
    'gate-goal': {
      summary: 'Write one sentence: "I want income" or "I want an asset."',
      details: [
        'Income: $1–3M a year, you keep working. The matching vehicle is packaged expertise: coaching, a course, a membership, done-with-you. Fast, low capital, caps hard, and almost nobody sells one for $10M+ without a 30-year brand.',
        'Asset: a company someone else can own. The matching vehicle is a normal service or local business with retention, productized delivery, and a second person who can sell and deliver. Slower, more cash tied up, much more sellable.',
        'If the idea only works if you keep both, it fails. Commitment means eliminating the other option.',
      ],
      warning: 'Course or coaching scored on the asset weights will lose to a boring service you have already operated.',
    },
    'gate-done-work': {
      summary:
        'Have you personally done the job for this customer, in this market, long enough to know the problems they have not said out loud yet?',
      details: [
        "Banks would not lend to a gym owner with no gym experience, and an agency owner who had never closed a real-estate deal was told to get a license and do the job before teaching it. Y Combinator's version of the same rule: past time in the market.",
        'Fail, or send it back, if the plan is "I will teach a niche I have only watched."',
      ],
    },
    'gate-one-product': {
      summary: 'Until about $1M, can the idea be described in one sentence: one customer, one offer, one way you will reach them?',
      details: [
        'If the idea needs two avatars, two products, or "we\'ll see which channel works," it fails this gate. You can add a backend, a second channel, and a wider market after the first combination is reliable.',
        'The $1M to $10M stage is where lifetime value gets built. The $0 to $1M stage is one pipe that works.',
        'An idea is not real until it has a named customer, a priced offer, and a way the first five customers show up without ads. "A marketplace for X" fails that test until you can say who pays, how much, and how you reach ten of them this week.',
        'A quick test: can a stranger repeat your offer after hearing it once?',
        "The shower-door operator beat the custom-glass shop because one product was easy to explain, easy to deliver, and easy to repeat. The modular pool beat the resort pool for the same reason. One gym's promotion peeled off one body part, “Big Booty Boot Camp,” and sold it to people who already trained.",
      ],
    },
    'gate-industry': {
      summary: 'Is the industry growing, or are you fighting a headwind?',
      details: [
        'Headwinds: newspapers, traditional schooling, tobacco, alcohol, and commodity retail. Tailwinds: AI, healthcare, cybersecurity, alternative education, and energy.',
        'A flat industry passes; Market tailwind scores how much it helps. Fail an industry that shrinks year after year, or a fad that has already peaked.',
        'Check demand right now, too. Pass when buyers are already searching, asking and paying for this. Fail when demand is falling and buyers are leaving, or the market is a fad that has already peaked.',
      ],
      warning:
        'A second business started because the first one hit a wall: the wall is usually a missing skill. Write the sentence "I do not know how to hire and train a [role]" and solve that, unless the industry itself is shrinking.',
      note: 'product-market-fit',
    },

    // ---------- Evaluation framework: the 12-line scorecard ----------
    stickiness: {
      summary: "How much of last year's revenue from the same customers is still there next year?",
      details: [
        'Logo retention (how many customers stay) decays. Revenue retention can exceed 100% if the customers who stay spend more.',
        'The retention map for subscriptions: the big drop is month one (often over 20%), the next is around month three, and after month six churn falls toward about 2% a month. An idea gets 5 stars only if you can name what happens in the first 30 days, at day 90, and at month six.',
        'If you can only have one advantage, take this one. A business that must replace every customer every year is a sales job with overhead.',
        'Example A: You formulate a vegan food product which can be purchased over and over, perhaps weekly.',
        'Example B: You run a software service that deploys a monthly subscription.',
        'Example C: You write a book that can only be read once.',
      ],
      scale: [
        '5 stars: A reason to pay every month that is structural. Consumable, community, monitoring, software they run the business on, insurance, a service that breaks if it stops. Clear path from a cheap plan to an expensive one.',
        '3 stars: They come back, but you have to resell them every time.',
        '1 star: One transaction. They learn it, or the roof is replaced, and they are done.',
      ],
    },
    'gross-margin': {
      summary: 'Price minus the cost of delivering that unit. What is left is what you can spend to get the next customer.',
      details: [
        'Rent and your own salary stay out of this number.',
        'Low margin is not always fatal. It becomes fatal when acquisition costs rise, which they always do.',
      ],
      scale: [
        '5 stars: Media, software, information, community, data, supplements, pharmaceuticals. A penny to make, a dollar to sell. Service businesses should reach 80% or better when the model is designed well.',
        '3 stars: A service with real labor, still above roughly 50% after delivery payroll.',
        '1 star: Food, grocery, restaurants, farming, anything elastic and commodity. Pennies on the dollar.',
      ],
      warning: 'A restaurant or retail product with no repeat and thin margin sits on the wrong side of both stickiness and margin.',
    },
    'market-tailwind': {
      summary: 'Does the category grow without you?',
      scale: [
        '5 stars: The category grows without you. Alternative education above 20% a year, plus AI, healthcare, cybersecurity, energy.',
        '3 stars: Flat. Your growth has to come entirely from taking share.',
        '1 star: The category shrinks every year.',
      ],
    },
    'operational-drag': {
      summary:
        'How many variables do you manage to produce one more unit, and how much cash must you sink before that unit exists?',
      details: [
        "Capital can be a moat later. Early, the constraint should be demand, not a buildout. The exception is a physical business you have chosen on purpose as the asset path. Then score the drag honestly and make the return on a new location good enough that other people's money wants in.",
        '"$100k in, three years to get it back" is a mediocre offer to an investor. "$100k in, $300k back in year one" is a business.',
      ],
      scale: [
        '5 stars: One more customer does not require a new location, a new machine, or a new hero. A podcast ad read is the example. Software sits here too.',
        '3 stars: People-heavy, but no storefront. An agency sits here. High margin, and also a crowd of competitors with no barrier.',
        '1 star: Leases, buildout, inventory that spoils, permits, hundreds of employees per new unit.',
      ],
      warning:
        'Software added on to make a service "sticky" or to chase a multiple: software companies compete with software companies, and acquirers are not fooled by a service with a login. If you start software, kill the service and hire a real technical lead. Do not straddle.',
    },
    moat: {
      summary: 'Can others cheaply copy what you sell?',
      details: [
        'Brand is the favoured moat for ordinary services. Revlon costs more than the drugstore label made on the same belt.',
      ],
      scale: [
        '5 stars: Something others cannot cheaply copy: a recipe, a patent, proprietary data, a brand people pay extra for even when the product comes off the same line, or enough capital and skill that entrants bounce.',
        '3 stars: A brand, a specific process, or a niche so narrow that generalists sound stupid in it.',
        '1 star: Anyone with a laptop can sell the same thing next week. Social media marketing agencies are the example. Price falls.',
      ],
      warning:
        'Commodity agency or "AI agency": margin and speed look fine, but stickiness, moat, and proof usually do not. They plateau around the low millions selling a $1,500 monthly service to small businesses.',
    },
    'value-equation': {
      summary: 'Value = (dream outcome × perceived likelihood) ÷ (time delay × effort and sacrifice).',
      details: [
        'Effort means new things they must do and dislike. Sacrifice means things they must stop that they enjoy. The bottom of the fraction persuades more than the top, because claims are cheap and a shorter, easier path is operational.',
        'Score the best version of the offer you can actually deliver, not the slogan.',
        'Onboarding has to name their real outcome, not your metric. "Make $10k a month" scored worse than "your wife stays home with the kids," which was why they wanted the $10k.',
      ],
      scale: [
        '5 stars: You can cut the time in half versus the normal way, remove steps, and show proof from people like them. Done-for-you is the easiest to sell and the hardest to fulfill. That is the correct starting side of the trade. Peel the hand-holding off later, after cash and reps exist.',
        '3 stars: The outcome is specific and you have proof, but the customer still does most of the work over months.',
        '1 star: You can only describe the outcome. Time and effort stay as bad as the status quo.',
      ],
    },
    guarantee: {
      summary: 'Is there a guarantee with a consequence: if you do not get X in Y time, we will Z?',
      details: [
        'The offer is the bridge, not the feature list. It has to solve the whole path, including problems they do not know they will hit, and one or two problems that only appear after they succeed.',
        '"Guaranteed" with no Z is weak. Types, from strongest signal to most selective: unconditional (money back regardless; run it as math, a large lift in sales can survive a jump in refunds), conditional (they did the work, the result missed, you refund, credit, or keep working free), performance (you get paid when the result happens), and anti-guarantee (you explicitly refuse one, because the work is on them and the buyer who needs a guarantee is the wrong buyer).',
        'Do not discount the core price. Add a bonus, or change the terms (they refer three people, they leave reviews). Price confers value: people rated the expensive wine best when all three bottles were the same wine.',
        'Early on, free or cheap is allowed for the first proof, so you can raise the price. Lowering a price that already worked is the mistake. Gym Launch cut a $42k program to chase churn, churn did not move, and the lost profit is the lesson.',
      ],
      scale: [
        '5 stars: An unconditional or "we work free until you hit it" guarantee, plus bonuses that each feel worth the price alone, plus a name that makes it a category of one. The six-week challenge beat "gym membership" because nothing else on the market was comparable.',
        '3 stars: A conditional or performance guarantee you can honor without going broke.',
        '1 star: You will not attach a consequence. Fix the product and stop selling this version.',
      ],
    },
    'cash-30-day': {
      summary: "Does the gross profit from a customer's first 30 days cover the cost to acquire and serve two more customers?",
      details: [
        'A money model is a deliberate sequence: attraction, upsell, downsell, continuity.',
        'Attraction: the offer that maximizes the number of people who say yes and pulls cash forward. Upsell: more gross profit per buyer, sold at the moment of greatest need, not greatest satisfaction. Downsell: a smaller yes for people who would have been a zero; dangerous if it steals people who would have bought the expensive thing, so present the full offer first. Continuity: why they are still paying in month seven.',
        'Passing the test lets one customer pay for the next one inside a credit-card float. Failing it is lighting real money on fire.',
        'People have more than one wallet. Membership money and supplement money and apparel money are different pools.',
      ],
      scale: [
        '5 stars: You can describe the sequence and the 30-day number beats the test. The gym version: win-your-money-back challenge at the point of highest pain, supplements inside 48 hours, deposit rolled into the year, then a prepay discount. Same hundred leads, roughly five times the allowable cost per lead versus a $21 trial.',
        '3 stars: You cover acquisition cost inside 30 days, with little left over.',
        '1 star: You get paid after months of delivery. A $99 membership with a $500 acquisition cost.',
      ],
    },
    'ltgp-cac': {
      summary: "How many times over does a customer's lifetime gross profit pay back what it cost to win them?",
      details: [
        'Lifetime gross profit is not revenue: price minus delivery cost, times how long they stay or how many times they buy. Ten months at $2,000 is not $20,000 of lifetime value if half of that is delivery payroll and ad spend wrapped into the fee.',
        'Acquisition cost is everything required to produce the customer: media, marketing payroll, and sales commissions, divided by customers won. Use a year if you have it.',
        "The hair-extension teacher's education product was about 30 to 1 and the coaching product about 7 to 1. Advertising the 30-to-1 product and ascending people took the blended ratio toward 75 to 1. Build lifetime profit from the expensive end backward. Cut acquisition cost from the ad forward, because the front of the funnel touches everyone.",
        'Eight moves if the ratio is weak: raise price, lower delivery cost, more purchases, a cross-sell, a better version, more units, a smaller version that saves a no, a worse version on purpose. Pick the one that adds the least operational drag.',
        'Also check payback, not just the ratio. A 100-to-1 return on ten dollars is a hobby. A 2-to-1 return on a million dollars can be the better business.',
      ],
      scale: [
        '5 stars: 10 to 1 or better, with a believable path higher by stacking a backend.',
        '3 stars: 3 to 1 or better, and you can show the math.',
        '1 star: You cannot estimate either number, or the ratio is under 3 to 1.',
      ],
    },
    'first-customers': {
      summary: 'Can you get the first customers without a budget?',
      details: [
        'The core four, in the order a beginner should use them: warm outreach, content, cold outreach, paid ads. If you only do two, do warm outreach and content. Customers, employees, affiliates, and agencies are how other people later run those four for you.',
        'First proof can be free, for people who look like the real customer, in exchange for a result you can show. Then you charge full price. A public "I am open" post comes after the proof exists, not before.',
      ],
      scale: [
        '5 stars: You can make 100 reach-outs a day for 90 days, with an offer a stranger can understand in one sentence. Volume is the skill-builder. Three hundred flyers is not a test. Five thousand flyers a day for thirty days is.',
        '3 stars: You can list 100 people who already know you and match the avatar, and you will contact them.',
        '1 star: The only path is ads, an audience you do not have, or a platform that can turn you off.',
      ],
    },
    'proof-loop': {
      summary: "Does each customer's result bring in the next customer?",
      details: [
        'Get a customer, get them a result, capture the result, use it to get the next customer. If the only way to grow is more spend, the product is not earning word of mouth, and word of mouth is the one channel that compounds. The others are linear and get less efficient as you scale.',
        'The question to ask: if the only permissible source of customers were existing customers bringing new ones, what would delivery have to look like? Build that version.',
      ],
      scale: [
        '5 stars: The result has a date on it (a weigh-in, a booked call, a before-and-after) and asking for the proof is part of delivery, not a favor.',
        '3 stars: You can collect a testimonial if you remember to ask.',
        '1 star: The customer does the work, you never see the win, and nothing is recorded.',
      ],
    },
    'can-leave': {
      summary: 'Does the company still run when you stop doing fulfillment, then marketing and sales, then the decisions?',
      details: [
        '"It runs without me" does not mean you stopped training the sessions. It means the phone does not ring when a pipe breaks.',
        'Simple scales. Fancy fails. A sales script that could be taught in about 75 minutes outperformed 100-hour courses because a new person could finish it and close.',
        "Example A: You're a web developer and earn income designing websites. When you stop working, your income also stops.",
        'Example B: You invent a product that is sold worldwide in retail stores; the product is salable 24/7.',
      ],
      scale: [
        '5 stars: The offer is productized, one channel produces customers in a ratio you can write down, and a named role could run the unit with authority that matches the responsibility. The location-operator model: on-target earnings set by the skill required, half as base, half as a percentage of location profit, and a dollar limit they can spend without calling you.',
        '3 stars: Delivery can be taught from a short script. Sales still needs you.',
        '1 star: You are the ads, the sales call, and the delivery. Three layers of key-man risk. Normal for a brand-new income business. Fatal for an asset score. Massage therapy and onsite consulting are examples.',
      ],
    },

    // ---------- Ideation Calculator board ----------
    'need-solution-value': {
      summary: 'How unique or valuable will your product/service be relative to what already exists in the marketplace?',
      details: [
        'How much value will your potential customer perceive relative to price? How unique and differentiated will your product or service be? What will make your business STAND-OUT differently from other similar options? What advantages will there be to buying from you versus someone else? How many value attributes will you be skewing? Positively skewed value attributes, such as better ingredients, better packaging, better service, better features, better price, better this, better that, make up the aggregate of your offer. The more skewed attributes, the more unique and valuable your offer becomes.',
        'When people perceive value through unique skews (your X, Y, and Z is so much better!) it compels buyers.',
      ],
      scale: [
        '4 or 5 stars: Your idea (or its marketing) is extremely unique and provides a ton of value.',
        '3 stars: Your idea is somewhat unique and valuable.',
        '2 stars: Your idea is not much different from what already exists.',
        '1 star: Your idea is identical to others or is a commodity.',
      ],
      warning:
        'Misjudging value is the biggest mistake entrepreneurs make. Most ventures fail because no need ever existed, or the need and its solution is mispriced relative to what already exists.',
    },
    'market-entry': {
      summary: 'How complicated and costly (time, skill, money) will it be to launch your business into the marketplace?',
      details: [
        'How much resources (time, skill, money) will be needed to start selling? How much time, money, and expertise is involved in the creation of your business, from idea to launch into the marketplace? Once you start your business, how difficult will it be for some other person or company to compete with you? Is getting in business as simple as filling out a form and buying some products? Or is it a complicated endeavor consisting of problem solving, specialized skill, creative juice, and/or money?',
        'Example A: You completed an online form and now sell t-shirts. Your launch process was one hour.',
        'Example B: You invent a new product that requires CAD design and special manufacturing. Between engineering, prototyping and manufacturer sourcing, your launch process was six months and $15K.',
        'Typically the easier it is to enter a market, the worse the opportunity is as margins and value skew opportunities erode.',
        'This line rewards a launch that is hard for others to copy; Small Cost to Try rewards testing demand cheaply first. An idea can score well on both: cheap to test, hard to copy once built.',
      ],
      scale: [
        '4 or 5 stars: Your idea requires a lot of time, money, and skill to get to market.',
        '3 stars: A moderate level of time, money, and skill is needed to get to market.',
        '2 stars: You can launch your business in a matter of days or weeks.',
        '1 star: You can launch your business in a matter of minutes or hours.',
      ],
    },
    'control-dependency': {
      summary: 'Will your business have any major third-party dependencies?',
      details: [
        'Is there ONE company that your company will rely on? For revenue? For operation? Will your business be RELIANT and SUBORDINATE to a third-party for its existence? In other words, can ONE parent company arbitrarily make a decision or a policy change and put you out of business?',
        "Examples: You join a network marketing company (Avon/Amway/Herbalife) where your business is a function of the parent company. If the parent goes bankrupt, so do you. You create a mobile game that only works on the Facebook platform. If Facebook changes some policy or removes your game, you're out of business. You import a product which is only sold on Amazon. If Amazon terminates your account, you're out of business.",
        'Optimally, while all businesses will leverage third-parties for a variety of functions (advertising, manufacturing, administration) not ONE company should have the power to instantaneously destroy your business.',
        'While third-party parent-child relationships can work out, sometimes indefinitely, they pose a substantial risk.',
      ],
      scale: [
        '5 stars: You have no third-party risk.',
        '3 or 4 stars: You have third-party risk, but it is diversified among many companies.',
        '2 stars: You have third-party risk, but it is diversified among a few companies.',
        '1 star: You have a third-party risk with ONE company.',
      ],
    },
    replication: {
      summary: 'Once your solution/product/service is created, how easy will it be to replicate?',
      details: [
        'Can you readily service a demand for hundreds? Or millions? How easy or hard will it be to replicate your product/service/solution over and over once you conquer its creation process?',
        'Example A: You invent a product that required some engineering. Once it is prototyped and manufactured, replicating it is simply a matter of placing a larger order with the manufacturer.',
        'Example B: You write a book that took you 1 year to write, and printing it 1,000,000 times is as simple as a print order.',
        'Example C: You are a high priced consultant but only can consult X many hours per week.',
      ],
      scale: [
        '4 or 5 stars: You can replicate your business solution with relative ease.',
        '3 stars: You can replicate your business solution with moderate work.',
        '2 stars: You cannot replicate your business solution without significant work.',
        '1 star: You cannot replicate your business solution easily, or it is tied to time.',
      ],
    },
    'market-size': {
      summary: 'How large or small is the total addressable market (TAM) for which your idea/business will serve?',
      details: [
        "If you acquired the total market, how large is it? Millions? Billions? Trillions? If your business idea serves a smaller market but is a BIG TICKET item (magnitude VS scale) your rating here will need to reflect that. Building homes has high magnitude, selling a book has low magnitude. How many people or business organizations will find your business idea/solution valuable? Or, what is the magnitude of the value you're providing? Does one sale deliver profit of $5? Or $500,000? What is the total market size you are targeting? Twenty million? Or Twenty billion? Or similarly, how many people could consume your product, either through direct purchase, or third-party?",
        "Example A: You invent a product that car manufacturers would purchase. Your buyers aren't car owners, but car manufacturers. Still, your market is every car owner indirectly through a B2B intermediary.",
        'Example B: You wrote a book that helps mothers homeschool quintuplets. Your market is small.',
      ],
      scale: [
        '4 or 5 stars: Your market size is substantial and billions of entities could be buyers, or each sale is worth a great deal.',
        '3 stars: Your market size is moderate and millions of entities could be buyers, or each sale is worth a moderate amount.',
        '2 stars: Your market size is smaller and thousands of entities could be buyers.',
        '1 star: Your market size is small and hundreds of entities could be buyers, and each sale is worth little.',
      ],
    },
    'market-access': {
      summary: 'How easy/hard would it be to reach your target market through your marketing efforts?',
      details: [
        'Are there mediums and marketing channels that hit your target market? How hard is it to reach your potential buyers, or to determine who they are? Are there mediums and channels that hit your desired market?',
        'Example A: You invent a human resource management system for mid to large sized companies. Your buyer would be a C-Suite executive who is not easily reached, either directly through contact or indirectly by an advertising medium, such as Facebook.',
        'Example B: You formulate a product that skiers would love. There are many channels and mediums that could target skiers.',
      ],
      scale: [
        '4 or 5 stars: You can target your market with relative ease.',
        '3 stars: You can target your market with some moderate effort.',
        '2 stars: Targeting your market is hard and/or laborious.',
        '1 star: Targeting your market is nearly impossible.',
      ],
    },
    'small-cost': {
      summary: 'Can you test the idea for little money before you spend more time on it?',
      details: [
        'On your side, the test itself stays cheap. Pre-sell.',
        'Run a few hundred to a thousand dollars of ads across markets before you start.',
        'The rule of 100 is 100 reach-outs a day, or $100 a day of ads, for 90 days. That is the whole experiment to try before you spend more time.',
      ],
      scale: [
        '4 or 5 stars: You can pre-sell it, or test it with a few hundred to a thousand dollars of ads or the rule of 100.',
        '3 stars: A fair test needs a simple prototype or a few thousand dollars first.',
        '2 stars: You must build most of the product before anyone can pay for it.',
        '1 star: There is no way to test demand without a large investment.',
      ],
    },
    'sells-already': {
      summary: 'Do people already pay someone for this outcome?',
      details: [
        'People already pay someone for this outcome. You win by doing the known thing better, for a narrower customer. Dry cleaning, lawn care, shower doors, and gyms are the examples.',
        'Better beats new. A proven category with a faster, easier, more certain version is a business. A category you have to create is a campaign you will fund yourself.',
      ],
      scale: [
        '4 or 5 stars: You can name the incumbents, their price, their weak delivery, and ten buyers you could talk to this week.',
        '3 stars: People pay for this, but you can’t yet name the incumbents, their price or ten buyers.',
        '2 stars: People only pay for something near it and would have to switch to your version.',
        '1 star: You must first convince the market that the problem exists.',
      ],
    },
    collectable: {
      summary: 'Collectors spend up to 10,000 times more than a subscriber.',
      details: [
        'A subscriber pays the same fee every month. A collector has no ceiling: they buy the whole set, the rare variant, and a second copy to keep sealed. The biggest collectors spend up to 10,000 times what a subscriber does.',
        'Things become collectable when there is a set to complete, a limited run, rare variants, and other collectors to show, trade and resell to.',
        'Examples: trading cards, LEGO, sneakers, watches, coins and stamps.',
        'Numbering a product does not make it collectable. Ask whether people would want the next one even though the one they have still works.',
      ],
      scale: [
        '4 or 5 stars: It is made to be collected: sets to complete, limited editions or rare variants, and a community that shows, trades and resells them.',
        '3 stars: Customers buy new designs, versions or editions because they want to own them, but there is no set to complete or rarity to chase.',
        '2 stars: Some customers buy a second one or the newer version, but to use it, not to own it.',
        '1 star: Nobody needs more than one, like a service, software or a one-time purchase.',
      ],
    },
  };

  // The framework's scorecard guides describe 1, 3 and 5 stars (its 0, 2 and 4 points).
  const FRAMEWORK_SCALE = 'How many stars (2 or 4 when it falls between)';
  for (const id of ['stickiness', 'gross-margin', 'market-tailwind', 'operational-drag', 'moat', 'value-equation',
    'guarantee', 'cash-30-day', 'ltgp-cac', 'first-customers', 'proof-loop', 'can-leave']) {
    CRITERIA[id].scaleLabel = FRAMEWORK_SCALE;
  }

  // Notes used by several criteria. Each criterion shows the full note in its own guide.
  const NOTES = {
    'product-market-fit': {
      title: 'Product/market fit',
      sections: [
        {
          title: 'The core truth',
          items: [
            "Market is the most important factor in a startup's success or failure",
            'Team and product quality matter, but market matters most',
            'The only thing that matters is getting to product/market fit',
          ],
        },
        {
          title: "Rachleff's Law",
          items: [
            'When a great team meets a lousy market, market wins',
            'When a lousy team meets a great market, market wins',
            'When a great team meets a great market, something special happens',
          ],
        },
        {
          title: 'Before Product/Market Fit (BPMF)',
          items: [
            'Focus obsessively on getting to product/market fit',
            'Do whatever is required: change people, rewrite product, switch markets',
            'You can ignore almost everything else',
            'The #1 company-killer is lack of market',
          ],
        },
        {
          title: "Signs Product/Market Fit isn't happening",
          items: [
            "Customers aren't getting value from the product",
            "Word of mouth isn't spreading",
            "Usage isn't growing fast",
            'Sales cycle takes too long',
          ],
        },
        {
          title: "Signs you've achieved Product/Market Fit",
          items: ['Customers buy the product as fast as you can make it', 'Money piles up in your company account'],
        },
        {
          title: 'Market dynamics',
          items: [
            'A great market pulls product out of the startup',
            'The market will be fulfilled by first viable product',
            "Product doesn't need to be great; it just has to basically work",
            'Team quality matters less than ability to ship viable product',
          ],
        },
        {
          title: 'Product principles',
          items: [
            'Quality is separate from market size',
            'Great products can sometimes create new markets',
            "Don't count on your product creating a market from scratch",
            'Even a mediocre product can win in a great market',
          ],
        },
        {
          title: 'Team realities',
          items: [
            'Great teams often fail in bad markets',
            'Great teams can screw up products',
            'Second/third time founders can get cocky and fail',
            'Weak teams can succeed in explosive markets',
            'A great team will beat a mediocre team in the same market',
          ],
        },
      ],
    },
  };

  return { CRITERIA, NOTES };
});
