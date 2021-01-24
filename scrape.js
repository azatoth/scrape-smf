const scrapeIt = require("scrape-it");
const download = require("image-downloader");
const { program } = require("commander");
const mkdirp = require("mkdirp");
const path = require("path");
const fs = require("fs");
const { DateTime } = require("luxon");
const { promisify } = require("util");
const parser = require("any-date-parser");
program
  .version("1.0.0")
  .description("Scrapes SMF thread and downloads the images")
  .requiredOption("-o, --out <dir>", "output directory")
  .requiredOption("-u, --url <href>", "start url")
  .option("-f, --filter <username>", "only process images from poster");

program.parse(process.argv);

const options = program.opts();

const writeFile = promisify(fs.writeFile);
async function main() {
  await mkdirp(options.out);
  const posts = await scrapeSMF(options.url);
  for await (const post of posts) {
    if (options.filter && options.filter !== post.poster) {
      continue;
    }
    await mkdirp(path.join(options.out, post.poster));

    const meta = path.join(
      options.out,
      post.poster,
      `META_${post.post.date}.json`
    );
    console.log(meta);
    await writeFile(
      meta,
      JSON.stringify({
        poster: post.poster,
        date: post.post.date,
        description: post.post.text,
        images: post.post.images.map((i) => i.txt),
      })
    );
    for await (const image of post.post.images) {
      const local_img = await download.image({
        url: image.src,
        dest: path.join(options.out, post.poster, image.txt),
      });
      console.log(local_img.filename);
    }
  }
}
const postRE = /«.*?on: (?<date>.*?) »/;

main();
async function scrapeSMF(url) {
  console.log(`Processing ${url}`);
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

  if (data.next) {
    return posts.concat(await scrapeSMF(data.next));
  }

  return posts;
}
