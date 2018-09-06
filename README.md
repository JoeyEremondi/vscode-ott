# ott-vscode

Provides syntax highlighting and inline error reporting 
for the [Ott semantics tool](http://www.cl.cam.ac.uk/~pes20/ott/).

![Screenshot of Ott Extension](./media/screenshot.png)

## Features

### Syntax Highlighting 

The emphasis is on visually distinguishing the meta-language from the language being modeled.
As a result, the files end up quite colorful.

I've optimized this for the One Dark Pro theme, but it should look okay with any theme. Some
classes might not get distinguished if your theme doesn't define colors for enough scopes, though.

I'm no expert when it comes to visual design, so pull-requests are welcome with regards
to the color choices.

### Build-on-Save and Inline Error Reporting

When you save your file, it will be run with `ott` and any errors will be reported inline. 

By default, `ott` is run with no arguments. However, if your file contains a magic comment of the form:

```% !Ott output file.ext``` 

Then, Ott will be run with with the option `-o file.ext`.

Other magic comments are avaliable:

* ```% !Ott flag NAME``` passes `-flag` to ott
* ```% !Ott option NAME VALUE``` passes `-name value` to ott
* ```% !Ott binary /some/path``` uses `/some/path` as the command to invoke Ott
* ```% !Ott noCheckOutputs``` disables checking the Coq outputs  
* ```% !Ott noOutputSourceLoc``` disables source locations in output (and checking the Coq outputs)  

#### Checking generated code
If Coq is specified as an output, then the plugin will attempt to
compile the generated Coq code, tracing any errors or warnings back to
their origin in the Ott file.

This can be disabled with the `noCheckOutputs` magic comment above.

## Requirements

Must have the Ott binary installed.

Syntax highlighting recognizes some languages within the `hom` blocks,
if you have a language pack installed for that language.
Recommended packages to allow this are:

* [VSCoq](https://marketplace.visualstudio.com/items?itemName=siegebell.vscoq) or [Coq](https://marketplace.visualstudio.com/items?itemName=ruoz.coq)
* [Isabelle](https://marketplace.visualstudio.com/items?itemName=makarius.isabelle)
* [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) or [LaTeX Language Support](https://marketplace.visualstudio.com/items?itemName=torn4dom4n.latex-support)

## Extension Settings

* `ott.ott_command`: the command used to invoke the Ott compiler. Defaults to `ott`.


## Known Issues

* Check-on-save always on, should be optional

## Future features

- [ ] Source-code formatting
- [ ] Inline unicode replacement, something like [prettify-symbols-mode](https://marketplace.visualstudio.com/items?itemName=siegebell.prettify-symbols-mode). 

## Contributing

Contributions are welcome and encouraged! Feel free to leave any issues or submit pull requests.
Alternately, if you would like to collaborate, I will happily add collaborators to the repo.

## Release Notes

### [ 0.0.7 ]
- Updated for Ott 0.29 error message format (see [#41](https://github.com/ott-lang/ott/pull/41))
- Remove buggy postprocessing command
- Revamp magic comments system
- Support for showing Coq errors in generated code
- Much more configurable

### [ 0.0.6 ]
- Fix regression in parse "no parse" errors
- Add parsing for "no conclusion" errors
- Internal warnings are now marked as Information, not Warning

### [ 0.0.5 ]
- postprocess uses exec, not spawn 

### [ 0.0.4 ]
- Error parsing for bad contextrules
- Add "postprocess" option for magic comments 

### [ 0.0.3 ]
- Remove ansi-strip dependency
- Add output from Ott binary to "Output" pane 

### [ 0.0.2 ]
- Improved and cleaner error parsing
- Add back brackets to surrounding pairs, remove single quotes (messes up with prime variables)
- Logo and screenshot added

### [ 0.0.1 ]

- Initial release





