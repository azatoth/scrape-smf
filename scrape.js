const commander = require("commander");
const { commandThread } = require("./commandThread");

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
