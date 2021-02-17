require("any-date-parser");

const scrapeIt = require("scrape-it");
const mkdirp = require("mkdirp");
const path = require("path");
const fs = require("fs");
const { DateTime } = require("luxon");
const download = require("download");
const chalk = require("chalk");
const Spinners = require("spinnies");
const { promisify } = require("util");
const { nanoid } = require("nanoid");
const { parse } = require("path");
const writeFile = promisify(fs.writeFile);

let spinners;

const commandThread = async (url, outdir, options) => {
  spinners = new Spinners();

  await mkdirp(outdir);
  const posts = await scrapeSMFThread(url);
  for await (const post of posts) {
    if (options.filter && options.filter !== post.poster) {
      continue;
    }
    await mkdirp(path.join(outdir, post.poster, post.post.date));

    const meta = path.join(outdir, post.poster, post.post.date, "META.json");
    spinners.add(meta, { text: meta });
    await writeFile(
      meta,
      JSON.stringify({
        poster: post.poster,
        date: post.post.date,
        description: post.post.text,
        images: post.post.images.map((i) => i.txt),
      })
    );
    spinners.succeed(meta);

    await Promise.all(
      post.post.images
        .reduce((acc, cur, idx, arr) => {
          let i = 0;
          const {name, ext} = parse(cur.txt);
          while (
            acc.some((o) => o.txt === (i === 0 ? cur.txt : `${name} (${i})${ext}`))
          ) {
            i++;
          }

          if (i !== 0) {
            cur.txt = `${name} (${i})${ext}`;
          }
          acc.push(cur);
          return acc;
        }, [])
        .map((image) => {
          const id = nanoid();
          return new Promise((resolve, reject) => {
            const target = path.join(
              outdir,
              post.poster,
              post.post.date,
              image.txt
            );
            spinners.add(id, { text: target });
            if (fs.existsSync(target)) {
              spinners.succeed(id, {
                text: `skipped ${target}`,
                succeedColor: "yellow",
              });
              resolve();
            } else {
              download(image.src)
                .on("end", () => {
                  spinners.succeed(id);
                  resolve();
                })
                .on("fail", () => {
                  spinners.fail(id);
                  reject();
                })
                .pipe(fs.createWriteStream(target));
            }
          });
        })
    );
  }
};
exports.commandThread = commandThread;
const postRE = /«.*?on: (?<date>.*?) »/;

async function scrapeSMFThread(url) {
  spinners.add(url, { text: chalk`{keyword("chocolate") Processing} ${url}` });
  const { data } = await scrapeIt(url, {
    posts: {
      listItem: "#forumposts .post_wrapper",
      data: {
        poster: ".poster h4",
        post: {
          selector: ".postarea",
          data: {
            date: {
              selector: ".keyinfo .smalltext",
              convert: (str) => {
                return DateTime.fromJSDate(
                  Date.fromString(postRE.exec(str).groups.date, "en-US")
                )
                  .toUTC()
                  .toISO({ suppressSeconds: true, suppressMilliseconds: true });
              },
            },
            text: ".post div",
            images: {
              listItem: ".attachments div > a[target=_blank]",
              data: {
                src: {
                  attr: "href",
                },
                txt: {
                  how: (foo) => {
                    return foo.next().next().text();
                  },
                },
              },
            },
          },
        },
      },
    },
    next: {
      selector: ".pagesection ~ .pagesection a.navPages:contains(Next)",
      attr: "href",
    },
  });
  const posts = data.posts.filter((post) => {
    return post.post.images.length > 0;
  });

  spinners.succeed(url);
  if (data.next) {
    return posts.concat(await scrapeSMFThread(data.next));
  }

  return posts;
}
