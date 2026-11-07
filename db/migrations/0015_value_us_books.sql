-- Best prices are flagged only at US books from Nov 7 on; drop the first batch's ungraded picks at books a US bettor can't use.
delete from bet_picks where model_version = 'value-v1' and result is null
  and book not in ('draftkings','fanduel','betmgm','caesars','william hill','betrivers','espn bet','fanatics','hard rock','bally bet',
                   'betparx','wind creek','bovada','mybookie.ag','betus','betanysports','fliff','superbook');
