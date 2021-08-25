const puppeteer = require("puppeteer");
const date = require("date-and-time");
const axios = require("axios");
var request = require("request");

require("dotenv").config();
// saving the data
const fs = require("fs");

let wallet_list = [];

function get_wallet() {
  new Promise((resolve) => {
    if (process.env.WALLET_LIST_URL) {
      request.get(process.env.WALLET_LIST_URL, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          wallet_list = body.toString().split("\n");
          resolve(true);
        } else {
          resolve(false);
        }
      });
    } else {
      resolve(false)
    }
  }).then((result) => {
    if(!result) {
      if (process.env.WALLET_LIST_LOCAL) {
        fs.readFile(process.env.WALLET_LIST_LOCAL, "utf8", (err, data) => {
          if (err) {
            console.error(err);
            return;
          }
          wallet_list = data.toString().split("\n");
        });
      }
    }
  });
}

setInterval(() => {
  get_wallet();
}, 3000);

function wallet_check(from_addr, to_addr) {
  for (const value of wallet_list) {
    if (value.trim() == from_addr.trim() || value.trim() == to_addr.trim()) {
      return true;
    }
  }
  return false;
}

const sleep = (ms) =>
  new Promise((res) => {
    setTimeout(res, ms);
  });

let contracts = [];
let tabs = [];

let get_count = [];

for(let key in process.env) {
  if(key.toString().indexOf("CONTRACT_ADDRESS") != -1) {
    contracts.push(process.env[key].trim());
  }

  if(key.toString().indexOf("TABS") != -1) {
    tabs.push(process.env[key]);
  }
}

if(contracts.length != tabs.length) {
  console.log("Please check the contact address and tabs!");
  process.exit();
}

let cts_num = 0;

let sid = setInterval(() => {
  auto_login_read(contracts[cts_num].trim(), tabs[cts_num].trim(), cts_num);
  if(++cts_num >= contracts.length) {
    clearInterval(sid);
  }
}, 0);

function auto_login_read(addr, tab, no) {
  let new_data = [];
  let old_data = [];
  let write_order = 0;
  let real_tabs = 0;
  const ts_addr = "https://tronscan.org/#/transaction/";

  (async () => {
    const browser = await puppeteer.launch({
      headless: process.env.DEV == "true" ? true : false,
    });

    const threads = tab >= 4 ? 2 : 1;
    const loops = parseInt(tab / threads);
    let mod = tab % threads;

    let start = 1;
    let end = loops;

    function open_tab() {
      let curr_open_tab = 1;
      let id = setInterval(() => {
        tabsopen(curr_open_tab, start, end);
        start += end;
        end += mod;
        if (curr_open_tab++ >= threads) {
          clearInterval(id);
        }
      }, 0);
    }
    
    open_tab();
    
    async function tabsopen(curr_tab, st, ed) {
      let selfid = curr_tab;
      let page = "";
      try {
        if(curr_tab == 1) {
          page = (await browser.pages())[0];
        } else {
          page = await browser.newPage();
        }
        await page.setDefaultNavigationTimeout(0);
        await page.setViewport({ width: 1600, height: 900 });
        const URL = "https://tronscan.org/#/token20/" + addr
        await page.goto(URL);

        fs.appendFile(
          "./code.log", "_Opened the tronscan homepage success \n", function (err, result) {}
        );
        console.log("_Opened the tronscan homepage success");
  
        const loop = async () => {
          let start = st;
          let end = st + ed;
          try {
            await page.waitForSelector("table");
            let loading = await page.$$("div.loading-style");
            do {
              loading = await page.$$("div.loading-style");
            } while (loading.length != 0);
            await sleep(500);
    
            let max_tab_num = await page.evaluate(async () => {
              let max_num = 0;
              const max = (item) =>
                max_num < item.innerText.trim() ? item.innerText : max_num;
              
              const tabs = document.querySelectorAll("ul.ant-pagination.ant-table-pagination.ant-table-pagination-right li.ant-pagination-item")
              for (const tab of tabs) {
                max_num = max(tab);
              }
    
              return max_num
            });

            real_tabs = tab <= max_tab_num ? tab : max_tab_num;
    
            const goto = await page.$("div.ant-pagination-options-quick-jumper input");

            const next = async () => {
              
              if (goto && start <= max_tab_num) {
                try {
                  if (start != 1) {
                    await goto.type(start.toString());
                    await goto.type(String.fromCharCode(13));
                    await page.waitForSelector("div.loading-style");
                    do {
                      loading = await page.$$("div.loading-style");
                    } while (loading.length != 0);
                    await sleep(500);
                  }
                  
                  let transaction_info = await page.evaluate(async () => {
                    const get_data = (row, td) =>
                      ((row.querySelector(`${td}`).innerText.trim()).split('\n')).join("");
          
                    // array to store data
                    const data = [];
          
                    // defining selector
                    const trs = document.querySelectorAll(
                      "table tbody.ant-table-tbody tr"
                    );
          
                    // looping over each team row
                    for (const tr of trs) {
                      data.push({
                        coin: get_data(tr, "td:nth-child(10) span"),
                        transaction: get_data(tr, "td:nth-child(1) span"),
                        block: get_data(tr, "td:nth-child(2)"),
                        from: get_data(tr,"td:nth-child(4) span > div:nth-child(1)"),
                        to: get_data(tr, "td:nth-child(6) span > div:nth-child(1)"),
                        status: get_data(tr, "td:nth-child(7) span"),
                        result: get_data(tr, "td:nth-child(8)"),
                        amount: get_data(tr, "td:nth-child(9) span"),
                      });
                    }
          
                    return data;
                  });
                  
                  let filter = transaction_info.filter((item) =>
                    wallet_check(item.from, item.to)
                  )
        
                  new_data[start - 1] = JSON.parse(JSON.stringify(filter));
                  let save_format = [];
                  new_data.forEach((item1) => {
                    item1.forEach((item2) => {
                      save_format.push(item2);
                    })
                  })

                  get_count[no] = save_format[0].coin + " " + save_format.length;
      
                  let diff_arr = save_format.filter((item1) =>
                    !old_data.some((item2) => 
                      item1.transaction.toString().trim() == item2.transaction.toString().trim() &&
                      item1.block.toString().trim() == item2.block.toString().trim() &&
                      item1.from.toString().trim() == item2.from.toString().trim() &&
                      item1.to.toString().trim() == item2.to.toString().trim() &&
                      item1.amount.toString().trim() == item2.amount.toString().trim()
                    )
                  );

                  console.log(`  Get transactions data`);
                  let log_format = "";
                  get_count.forEach((item) => {
                    log_format += `      + ` + item + " transactions\n";
                  })
                  console.log(log_format);

                  fs.appendFile(
                    "./code.log",
                    `  Get transactions data\n` + log_format + "\n",
                    function (err, result) {}
                  );
                  
                  diff_arr.forEach((item) => {
                    old_data.push(item);
                  })

                  // const confirm_ts = async () => {
                    // let ts_page = await browser.newPage();
                    // await ts_page.setDefaultNavigationTimeout(0);
                    // await ts_page.setViewport({ width: 1600, height: 900 });

                    let temp = [];
                    old_data.forEach(async (item, index) => {
                      await page.goto(ts_addr + item.transaction);
                      await page.waitForSelector("div.d-flex.band-item.item-belong");
                      const get_data = await page.evaluate(async () => {
                        const query = document.querySelectorAll("div.d-flex.band-item.item-belong");
                        const query_status = document.querySelector("span.badge.badge-success.text-uppercase.font-weight-normal.bage-status-text");
                        const data = [];
                        data.push(
                          query_status.innerText.trim(),
                          (query[1].innerText.split('\n')).join(""),
                          (query[3].innerText.split('\n')).join("")
                        )
                        return data;
                      })

                      item.status = get_data[0];
                      item.Bandwidth = get_data[1];
                      item.Energy = get_data[2];
                      temp.push(item);
                      old_data.splice(index, 1);
                    })
                    if(temp.length > 0) {
                      axios.post(process.env.WEBHOOK_URL, JSON.stringify(temp, null, 2))
                      .then(function (response) {
                        if (response.status == 200) {
                          console.log("     + webhook.site post success!");
                        }
                      })
                      .catch(function (error) {
                        console.log("     + webhook.site post faild: " + error);
                      });
  
                      try {
                        fs.writeFile(
                          `./data_${temp[0].coin}.txt`,
                          JSON.stringify(temp, null, 2),
                          function (err, result) {}
                        );
                      } catch (err) {}
                    
                      fs.appendFile(
                        "./code.log",
                        `     + Input new transactions to data_${temp[0].coin}.txt \n`,
                        function (err, result) {}
                      );
                      console.log(`     + Input new transactions to data_${temp[0].coin}.txt`);
                    }
                    // ts_page.close();
                  // }

                  // setTimeout(() => {
                    // confirm_ts();
                  // }, 0);
                  
                }catch(err) {}
              }

              if(++start < end) {
                next();
              } else {
                await page.goto(URL);
                loop();
              }
            }
            next();
          }catch(err){
            await page.goto(URL);
            loop();
          }
        };
        loop();
      } catch (err) {
        await page.close();
        fs.appendFile(
          "./code.log",
          "-  Error: something happen " + err + ". - Reloading the code\n",
          function (err, result) {}
        );
        console.log("-  Error: something happen " + err + ". - Reloading the code");
        tabsopen(selfid);
      }
    }
  })();
}
