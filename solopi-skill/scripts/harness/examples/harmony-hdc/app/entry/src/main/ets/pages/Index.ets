@Entry
@Component
struct Index {
  @State private counter: number = 0;
  @State private input: string = "";
  private rows: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  @State private showDetails: boolean = false;

  onBackPress(): boolean {
    if (this.showDetails) {
      this.showDetails = false;
      return true;
    }
    return false;
  }

  build(): void {
    Column({ space: 24 }) {
      if (this.showDetails) {
        Text('Harness Details')
          .id('details_title')
          .fontSize(32)
          .fontWeight(FontWeight.Bold)
          .fontColor('#1f1f1f')

        TextInput({ text: this.input })
          .id('test_input')
          .onChange((value: string): void => { this.input = value; })
        Text(this.input).id('input_echo')
        List() {
          ForEach(this.rows, (row: number) => {
            ListItem() { Text('Row ' + row.toString()).id('row_' + row.toString()).height(80) }
          }, (row: number): string => row.toString())
        }.id('test_list').height(240).width('100%')
        Text('Observation-bound actions are checked again immediately before execution.')
          .id('details_description')
          .fontSize(18)
          .fontColor('#595959')
          .textAlign(TextAlign.Center)

        Button('Back')
          .id('back_button')
          .fontSize(20)
          .onClick((): void => {
            this.showDetails = false;
          })
      } else {
        Text('SoloPi Harness Home')
          .id('home_title')
          .fontSize(32)
          .fontWeight(FontWeight.Bold)
          .fontColor('#1f1f1f')

        Text(this.counter.toString())
          .id('counter_value')
          .fontSize(52)
          .fontWeight(FontWeight.Bold)
          .fontColor('#1677ff')

        Row({ space: 16 }) {
          Button('Reset')
            .id('reset_button')
            .onClick((): void => {
              this.counter = 0;
            })

          Button('Increment')
            .id('increment_button')
            .onClick((): void => {
              this.counter += 1;
            })
        }

        Button('Open Details')
          .id('open_details_button')
          .fontSize(20)
          .onClick((): void => {
            this.showDetails = true;
          })
      }
    }
    .width('100%')
    .height('100%')
    .padding(32)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .backgroundColor('#f7f9fc')
  }
}
