const scrapeIt = require("scrape-it");
const commander = require("commander");
const mkdirp = require("mkdirp");
const path = require("path");
const fs = require("fs");
const { DateTime } = require("luxon");
const { promisify } = require("util");
const download = require("download");
const chalk = require("chalk");
const Spinners = require("spinnies");
require("any-date-parser");
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
    await mkdirp(path.join(outdir, post.poster));

    const meta = path.join(outdir, post.poster, `META_${post.post.date}.json`);
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

    await Promise.all(
      post.post.images.map((image) => {
        return new Promise((resolve, reject) => {
          const target = path.join(outdir, post.poster, image.txt);
          spinners.add(target, { text: target });
          if (fs.existsSync(target)) {
            spinners.succeed(target, {
              text: `skipped ${target}`,
              succeedColor: "yellow",
            });
            resolve();
          } else {
            download(image.src)
              .on("end", () => {
                spinners.succeed(target);
                resolve();
              })
              .on("fail", reject)
              .pipe(fs.createWriteStream(target));
          }
        });
      })
    );
    spinners.succeed(meta);
  }
};

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

const program = new commander.Command();

program.version("1.0.0");

program
  .command("thread <url> <outdir>")
  .description("Scrapes SMF thread and downloads the images", {
    url: "start url",
    outdir: "output directory",
  })
  .option("-f, --filter <username>", "only process images from poster")
  .action(commandThread);

program.parseAsync();
